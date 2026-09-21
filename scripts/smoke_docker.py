"""CI 容器验收：缺索引提示、本地 PBF、URL 下载、原子更新、网页与内置索引。"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Thread
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
from pbf_fixture import write_pbf
from release import run, smoke


def missing_data(image):
    container = run('docker', 'run', '-d', image, capture=True)
    try:
        for _ in range(30):
            result = subprocess.run(['docker', 'exec', container, 'python', '-c',
                "import urllib.request,urllib.error\ntry: urllib.request.urlopen('http://127.0.0.1:5050/')\nexcept urllib.error.HTTPError as e:\n assert e.code == 503 and '尚未准备地图数据' in e.read().decode()\nelse: raise AssertionError('expected 503')"],
                capture_output=True)
            if result.returncode == 0:
                return
            time.sleep(1)
        raise RuntimeError('缺索引时没有显示准备指引')
    finally:
        run('docker', 'rm', '-f', container)


def main():
    image = sys.argv[1]
    missing_data(image)
    user = f'{os.getuid()}:{os.getgid()}'
    bundle_image = image + '-bundle'
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        data = root / 'data'
        data.mkdir()
        fixture = root / 'fixture.osm.pbf'
        write_pbf(fixture)
        mount = f'{data}:/data'
        run('docker', 'run', '--rm', '--user', user, '-v', mount, '-v', f'{fixture}:/input/map.osm.pbf:ro',
            image, 'index', '/input/map.osm.pbf', '--region', 'japan')
        before = (data / 'current').resolve()
        failed = subprocess.run(['docker', 'run', '--rm', '--user', user, '-v', mount, image, 'index', '/missing.pbf'])
        assert failed.returncode != 0 and before == (data / 'current').resolve()
        empty = root / 'empty.osm.pbf'
        write_pbf(empty, with_track=False)
        rejected = subprocess.run(['docker', 'run', '--rm', '--user', user, '-v', mount,
                                  '-v', f'{empty}:/input/empty.osm.pbf:ro',
                                  image, 'index', '/input/empty.osm.pbf'])
        assert rejected.returncode != 0 and before == (data / 'current').resolve()
        server = ThreadingHTTPServer(('0.0.0.0', 0),
                                     partial(SimpleHTTPRequestHandler, directory=temp))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run('docker', 'run', '--rm', '--user', user, '--add-host', 'host.docker.internal:host-gateway',
                '-v', mount, image, 'index',
                f'http://host.docker.internal:{server.server_port}/fixture.osm.pbf', '--region', 'japan')
            cached = next((data / 'downloads').rglob('source.osm.pbf'))
            modified = cached.stat().st_mtime_ns
            run('docker', 'run', '--rm', '--user', user,
                '--add-host', 'host.docker.internal:host-gateway', '-v', mount, image, 'index',
                f'http://host.docker.internal:{server.server_port}/fixture.osm.pbf', '--region', 'japan')
            assert cached.stat().st_mtime_ns == modified
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        current = (data / 'current').resolve()
        assert current != before
        assert json.loads((current / 'metadata.json').read_text())['data_date'] == '2026-09-10'
        run('docker', 'run', '--rm', '--user', user, '-v', mount, image, 'validate')
        # 单独生成只含索引的上下文；验证内置版开箱即用。
        context = root / 'bundle'
        shutil.copytree(current, context)
        dockerfile = Path(__file__).resolve().parents[1] / 'Dockerfile.data'
        run('docker', 'build', '--build-arg', f'BASE_IMAGE={image}', '-f', str(dockerfile),
            '-t', bundle_image, str(context))
        smoke(bundle_image)
        # 验证内置版仍能通过挂载目录使用自备数据。
        container = run('docker', 'run', '-d', '--user', user, '-v', mount, bundle_image, capture=True)
        try:
            for _ in range(30):
                result = subprocess.run(['docker', 'exec', container, 'python', '-c',
                    "import urllib.request,json; r=json.load(urllib.request.urlopen('http://127.0.0.1:5050/health')); assert r['region']=='japan'"],
                    capture_output=True)
                if result.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('挂载索引后启动失败')
        finally:
            run('docker', 'rm', '-f', container)
    print('Docker 完整流程验收通过。')


if __name__ == '__main__':
    main()
