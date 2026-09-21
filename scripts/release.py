"""在 Actions 中发布；不把每日数据更新混入尚未发布的代码。"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def run(*args, capture=False):
    result = subprocess.run(list(args), check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def package_missing(image):
    # GHCR 对首次发布（整个包尚不存在）也可能返回 denied。
    # 只有认证后的 GitHub API 明确返回 404，才允许按首次发布处理。
    repository = os.environ.get('GITHUB_REPOSITORY', '').lower()
    token = os.environ.get('GH_TOKEN')
    if not token or not image.startswith(f'ghcr.io/{repository}:'):
        return False
    owner, package = repository.split('/', 1)
    scope = 'orgs' if os.environ.get('GITHUB_OWNER_TYPE') == 'Organization' else 'users'
    request = Request(f'https://api.github.com/{scope}/{quote(owner)}/packages/container/{quote(package, safe="")}',
                      headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                               'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urlopen(request, timeout=30):
            return False
    except HTTPError as error:
        if error.code == 404:
            return True
        raise


def exists(image):
    result = subprocess.run(['docker', 'manifest', 'inspect', image], text=True, capture_output=True)
    if result.returncode == 0:
        return True
    if re.search(r'no such manifest|manifest unknown|MANIFEST_UNKNOWN|name unknown', result.stderr):
        return False
    if 'denied' in result.stderr.lower() and package_missing(image):
        return False
    raise RuntimeError(f'无法确认镜像是否存在，停止发布：{image}\n{result.stderr}')


def export_index(image, destination):
    run('docker', 'pull', image)
    container = run('docker', 'create', image, capture=True)
    try:
        run('docker', 'cp', '-L', f'{container}:/data/current/.', str(destination))
    finally:
        run('docker', 'rm', container)


def smoke(image):
    # 真正启动 HTTP 服务，除了 pickle 校验还检查应用能否完整加载索引。
    container = run('docker', 'run', '-d', image, capture=True)
    try:
        for _ in range(60):
            result = subprocess.run(['docker', 'exec', container, 'python', '-c',
                "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5050/health', timeout=3)"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                return
            if run('docker', 'inspect', '-f', '{{.State.Running}}', container, capture=True) != 'true':
                break
            time.sleep(3)
        run('docker', 'logs', container)
        raise RuntimeError(f'容器启动检查失败：{image}')
    finally:
        run('docker', 'rm', '-f', container)


def promote(repository, tag, image):
    run('docker', 'buildx', 'imagetools', 'create', '-t', f'{repository}:{tag}', image)


def country(repository, base, revision, region, mode):
    previous = f'{repository}:{region}'
    url = f'https://download.geofabrik.de/asia/{region}-latest.osm.pbf'
    with tempfile.TemporaryDirectory(prefix=f'rail-{region}-') as temp:
        root = Path(temp)
        current = root / 'current'
        current.mkdir()
        metadata = {}
        if exists(previous):
            export_index(previous, current)
            metadata_path = current / 'metadata.json'
            if metadata_path.exists():
                metadata = json.loads(metadata_path.read_text())
        # 在目标程序镜像里读取格式版本，不能把工作流分支的版本混进来。
        version = int(run('docker', 'run', '--rm', '--entrypoint', 'python', base, '-c',
                          "import sys; sys.path.insert(0, '/opt/rail/app'); from index_store import INDEX_FORMAT; print(INDEX_FORMAT)",
                          capture=True))
        compatible = metadata.get('index_format') == version and metadata.get('region') == region
        if compatible and mode == 'data':
            signature = json.loads(run('docker', 'run', '--rm', '--entrypoint', 'python',
                base, '-c', "import sys,json; sys.path.insert(0, '/opt/rail/app'); from pbf_download import _probe; print(json.dumps(_probe(sys.argv[1])))",
                url, capture=True))
            if signature.get('validator') and signature == metadata.get('source_signature'):
                print(f'{region}：数据源未变化，跳过。', flush=True)
                return None
        if not compatible or mode == 'data':
            # 单独挂载工作目录，不覆盖导出的旧索引。
            work = root / 'work'
            work.mkdir()
            run('docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}', '-v', f'{work}:/data', base, 'index', url, '--region', region)
            shutil.rmtree(current)
            shutil.copytree((work / 'current').resolve(), current)
            metadata = json.loads((current / 'metadata.json').read_text())
        date = metadata.get('data_date')
        if not date or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            raise RuntimeError('PBF 未提供可信数据日期，无法发布日期标签。')
        image = f'{repository}:{region}-{date.replace("-", "")}-{revision[:7]}'
        if exists(image):
            existing = root / 'existing'
            existing.mkdir()
            export_index(image, existing)
            recorded = json.loads((existing / 'metadata.json').read_text())
            for field in ('data_timestamp', 'source_signature', 'index_format', 'region'):
                if recorded.get(field) != metadata.get(field):
                    raise RuntimeError(f'固定标签 {image} 已存在且数据不同，不覆盖；请检查数据源或发布新的代码提交。')
        else:
            # 索引和基础镜像分层，数据无需分别为两种 CPU 重建。
            run('docker', 'buildx', 'build', '--platform', 'linux/amd64,linux/arm64',
                '--build-arg', f'BASE_IMAGE={base}', '-f', str(ROOT / 'Dockerfile.data'),
                '-t', image, '--push', str(current))
        run('docker', 'pull', image)
        run('docker', 'run', '--rm', image, 'validate')
        smoke(image)
        return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['program', 'data'], required=True)
    parser.add_argument('--region', choices=['all', 'china', 'japan'], default='all')
    args = parser.parse_args()
    repository = f'ghcr.io/{os.environ["GITHUB_REPOSITORY"].lower()}'
    revision = run('git', 'rev-parse', 'HEAD', capture=True)
    base = f'{repository}:git-{revision[:7]}'
    if args.mode == 'program' and not exists(base):
        run('docker', 'buildx', 'build', '--platform', 'linux/amd64,linux/arm64',
            '--build-arg', f'REVISION={revision}', '-t', base, '--push', str(ROOT))
    run('docker', 'pull', base)
    # 后续镜像锁定基础镜像 digest，防止构建期间标签改变。
    base_digest = run('docker', 'inspect', '-f', '{{index .RepoDigests 0}}', base, capture=True)
    regions = ['china', 'japan'] if args.mode == 'program' or args.region == 'all' else [args.region]
    ready, failures = {}, []
    for region in regions:
        try:
            image = country(repository, base_digest, revision, region, args.mode)
            if image:
                ready[region] = image
                if args.mode == 'data':
                    promote(repository, region, image)
        except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
            failures.append(f'{region}: {error}')
    if failures:
        raise RuntimeError('\n'.join(failures))
    if args.mode == 'program':
        for region, image in ready.items():
            promote(repository, region, image)
        # 最后更新已发布代码的指针；每日任务据此选择代码。
        promote(repository, 'latest', base_digest)
    print('发布完成。', flush=True)


if __name__ == '__main__':
    main()
