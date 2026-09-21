"""Docker 入口：生成完整索引后原子切换，或启动网页。"""
import argparse
import fcntl
import json
import os
import resource
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

from index_store import INDEX_FORMAT, resolve_index, validate_index


def generate(source, root, region='custom'):
    # 下载缓存和锁不在索引目录内；新一代失败不会影响旧索引。
    from pbf_download import download_pbf
    import osmium
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / '.index.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('已有索引任务正在运行，请等待完成。')
        os.environ.setdefault('RAIL_DOWNLOAD_DIR', str(root / 'downloads'))
        download_started = time.monotonic()
        remote = urlsplit(source).scheme.lower() in ('http', 'https')
        pbf = download_pbf(source) if remote else Path(source).expanduser()
        download_seconds = time.monotonic() - download_started
        if not pbf.is_file():
            raise FileNotFoundError(f'本地 PBF 不存在：{pbf}')
        with osmium.io.Reader(str(pbf)) as reader:
            timestamp = reader.header().get('osmosis_replication_timestamp')
        # 数据日期只能来自 PBF 元信息，不能用下载时间冒充。
        data_date = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).date().isoformat() if timestamp else None
        versions = root / 'indexes'
        versions.mkdir(exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix='generation-', dir=versions))
        old = resolve_index(root)
        try:
            env = dict(os.environ, RAIL_DATA_DIR=str(stage))
            parse_started = time.monotonic()
            subprocess.run([sys.executable, str(Path(__file__).with_name('parse_osm.py')), str(pbf)],
                           env=env, check=True)
            parse_seconds = time.monotonic() - parse_started
            usage = resource.getrusage(resource.RUSAGE_CHILDREN)
            metadata = {
                'index_format': INDEX_FORMAT, 'region': region,
                'data_date': data_date, 'data_timestamp': timestamp or None,
                'generated_at': datetime.now(timezone.utc).isoformat(),
                'generator_revision': os.environ.get('RAIL_REVISION', 'local'),
            }
            if remote:
                state = json.loads((pbf.parent / 'download.json').read_text())
                metadata['source_signature'] = state['source']
            (stage / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
            validate_started = time.monotonic()
            validate_index(stage)
            validate_seconds = time.monotonic() - validate_started
            # 同一文件系统内只切换一个符号链接，避免混用两代索引。
            link = root / '.current-next'
            link.unlink(missing_ok=True)
            link.symlink_to(stage.relative_to(root), target_is_directory=True)
            os.replace(link, root / 'current')
        except BaseException:
            shutil.rmtree(stage)
            raise
        if old.parent == versions.resolve() and old != stage.resolve():
            shutil.rmtree(old)
        metrics = {
            'download_seconds': round(download_seconds, 2),
            'parse_seconds': round(parse_seconds, 2),
            'validate_seconds': round(validate_seconds, 2),
            'parse_cpu_seconds': round(usage.ru_utime + usage.ru_stime, 2),
            'parse_peak_rss_mib': round(usage.ru_maxrss / (1048576 if sys.platform == 'darwin' else 1024), 2),
            'index_mib': round(sum(p.stat().st_size for p in stage.glob('*.pkl')) / 1048576, 2),
        }
        print('构建统计：' + json.dumps(metrics), flush=True)
        print(f'索引已就绪：{root / "current"}；正在运行的网页请重启以加载新数据。', flush=True)


def serve(root):
    directory = resolve_index(root)
    if not (directory / 'way_to_nodes.pkl').exists():
        from flask import Flask
        from gunicorn.app.base import BaseApplication
        empty = Flask(__name__)

        @empty.get('/')
        def setup():
            return '<h1>尚未准备地图数据</h1><p>请先使用同一镜像运行 index 命令，完成后重启容器。</p><pre>docker run --rm -it -v "$PWD/data:/data" ghcr.io/sowevo/rail-explorer:latest index &lt;PBF网址或容器内文件路径&gt;</pre>', 503

        @empty.get('/health')
        def health():
            return {'ready': False}, 503

        class SetupServer(BaseApplication):
            def load_config(self):
                self.cfg.set('bind', '0.0.0.0:5050')
                self.cfg.set('accesslog', '-')

            def load(self):
                return empty
        SetupServer().run()
        return
    validate_index(directory)
    os.environ['RAIL_DATA_DIR'] = str(directory)
    os.environ.setdefault('RAIL_LOG_DIR', str(Path(root) / 'logs'))
    os.execvp('gunicorn', ['gunicorn', '--chdir', str(Path(__file__).parent),
                          '--bind', '0.0.0.0:5050', '--workers', '1', '--threads', '4',
                          '--timeout', '180', '--access-logfile', '-', 'app:app'])


def main():
    parser = argparse.ArgumentParser(description='Rail Explorer：默认启动网页，index 生成索引')
    sub = parser.add_subparsers(dest='command')
    index = sub.add_parser('index', help='从 URL 或本地 PBF 生成索引')
    index.add_argument('source')
    index.add_argument('--region', default='custom', choices=['custom', 'china', 'japan'])
    sub.add_parser('serve', help='启动网页')
    sub.add_parser('validate', help='检查索引完整性和格式')
    args = parser.parse_args()
    root = Path(os.environ.get('RAIL_DATA_DIR', '/data')).absolute()
    try:
        if args.command == 'index':
            generate(args.source, root, args.region)
        elif args.command == 'validate':
            validate_index(resolve_index(root))
        else:
            serve(root)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'{error}\n')
    except KeyboardInterrupt:
        parser.exit(130, '已中断，原索引不变，下载进度保留。\n')


if __name__ == '__main__':
    main()
