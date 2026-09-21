# Docker 数据管理与发布

[返回首页](../README.md)

镜像仓库：`ghcr.io/sowevo/rail-explorer`。直接启动命令见 [快速开始](../README.md#快速开始)。

| 标签 | 内容 |
| --- | --- |
| `latest` | 已发布的程序，不带数据 |
| `china` / `japan` | 已发布程序 + 对应国家索引，直接启动 |
| `<提交号>` | 固定程序，不带数据 |
| `china-YYYYMMDD-<提交号>` / `japan-YYYYMMDD-<提交号>` | 固定程序和数据；发布后不覆盖 |

支持 `linux/amd64` 和 `linux/arm64`。日期来自 PBF 的数据时间，而非下载时间。
网页“更多”菜单展示代码提交号、区域、数据日期。本地 PBF 缺少数据时间时显示“日期未知”。

### 直接使用中国或日本数据

```bash
docker run -d --name rail-explorer \
  -p 5050:5050 --restart unless-stopped \
  ghcr.io/sowevo/rail-explorer:japan
```

打开 http://localhost:5050 。中国数据把 `japan` 换成 `china` 即可。
镜像只内置索引，不带原始 PBF，不需要挂目录。
内置数据来自 Geofabrik 提供的 OpenStreetMap，© OpenStreetMap contributors，
按 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) 提供；
镜像内的数据声明位于 `/opt/rail/app/DATA_LICENSE.txt`。
行程仍保存在页面内存，刷新页面会清空，更新服务前先导出 KML。

### 自己生成索引：一个目录、两个步骤

先下载并生成索引：

```bash
docker run --rm -it \
  -v "$PWD/data:/data" \
  ghcr.io/sowevo/rail-explorer:latest \
  index https://download.geofabrik.de/asia/japan-latest.osm.pbf
```

或者使用已经下载的文件（直接读取，不复制原文件）：

```bash
docker run --rm -it \
  -v "$PWD/data:/data" \
  -v "/你的路径/map.osm.pbf:/input/map.osm.pbf:ro" \
  ghcr.io/sowevo/rail-explorer:latest \
  index /input/map.osm.pbf
```

再启动网页：

```bash
docker run -d --name rail-explorer \
  -p 5050:5050 \
  -v "$PWD/data:/data" \
  --restart unless-stopped \
  ghcr.io/sowevo/rail-explorer:latest
```

这些命令应在同一个工作目录执行，或始终使用同一个绝对数据目录。
一个目录对应一个区域，不合并多个 PBF。换国家请使用另一个数据目录。
默认区域名为“自定义”，需要时可在 `index` 命令末尾添加 `--region japan` 或 `--region china`。

目录结构：

```text
data/
├── downloads/       # URL 下载缓存，支持远端版本校验、复用和断点续传
├── indexes/         # 完整生成的一代索引
├── current -> indexes/generation-...  # 当前可用索引
└── logs/            # 网页运行日志
```

重建时先生成和验证新一代，成功后原子切换 `current` 并清理上一代；失败保留旧索引。
同目录不允许并发生成。下载和解析期间要为旧索引、新索引、下载临时文件留出空间。
更新数据后执行 `docker restart rail-explorer`，服务才会加载新索引。
缺少索引时，网页返回 503 并显示准备指引；不会在启动时自动下载地图。

### 更新程序或内置数据

快捷标签变化不会自动更新已有容器。先导出行程，再拉取并重建：

```bash
docker pull ghcr.io/sowevo/rail-explorer:japan
docker stop rail-explorer
docker rm rail-explorer
docker run -d --name rail-explorer \
  -p 5050:5050 --restart unless-stopped \
  ghcr.io/sowevo/rail-explorer:japan
```

自备数据版重建时需保留原来的 `-v` 参数。固定标签可用于回退。
索引格式不兼容时会提示重新生成，不会静默加载。
无数据镜像在容器里使用 Gunicorn，监听 5050；`/health` 是就绪检查接口。
Docker 默认以 root 写挂载目录；Linux 如需匹配宿主用户，可在生成与启动命令都添加
`--user "$(id -u):$(id -g)"`，并提前创建可写的 `data` 目录。

### GitHub Actions

- **Tests**：PR 和 main 更新只测试代码、构建本地测试镜像并验证容器入口，不发布。
- **Publish images → Run workflow → program**：手动发布当前默认分支程序，
  复用格式兼容的中日索引；没有索引或格式不兼容时重新生成。
  两国均验证成功才开始更新快捷标签，最后更新 `latest` 作为已发布代码的指针。
- **Publish images → Run workflow → data**：选择 `all/china/japan`，
  使用 `latest` 中记录的已发布提交；数据源版本未变就跳过。
  各国独立处理，一国失败不会阻止另一个更新。
- **每日更新**：首次手动发布并确认中日构建资源充足后，在仓库
  Settings → Secrets and variables → Actions → Variables 设置
  `ENABLE_DATA_UPDATES=true`，才启用每天 UTC 05:23 的检查。
  不设置变量就只支持手动发布。GitHub 定时任务可能延迟或因长期无仓库活动而停用。

镜像推送使用工作流的 `GITHUB_TOKEN`，不需要另存个人令牌。
首次发布后需在 GHCR 包设置中将包设为 **Public**，其他用户才能匿名拉取。
每日任务不能在首次程序发布之前运行。发布任务串行，不取消正在构建的版本。
固定标签遇到相同日期但不同数据时会报错，绝不覆盖已有版本。
GHCR 不支持多个标签的事务更新；网络中断可能导致快捷标签暂时处于不同批次，
重跑同次发布可恢复。当前不自动删除历史镜像，保留规则另行确定。

本地构建与验收（需 Docker、Python 依赖）：

```bash
docker build --build-arg REVISION="$(git rev-parse HEAD)" -t rail-explorer:local .
python scripts/smoke_docker.py rail-explorer:local
```

验收使用极小 PBF，覆盖无索引提示、本地文件、URL 下载、失败保留、
挂载数据启动和内置索引启动；索引任务日志分别记录下载、解析、校验耗时、解析 CPU 时间和解析进程峰值 RSS。
Actions 网络速度和总耗时以工作流日志为准，不能用其他服务器的下载速度推算。
RSS 只统计解析子进程，不包含容器文件缓存。
需要不兼容修改索引格式时，递增 `app/index_store.py` 中的 `INDEX_FORMAT`。

### 缓存与重复执行

- Python 测试环境使用 pip 下载缓存，由两份 requirements 文件决定缓存是否匹配。
- 测试镜像通过 BuildKit 的 GitHub Actions 缓存跨次复用，Tests 和 Publish images 共用
  `rail-test` 缓存范围。
- 正式程序镜像将两种架构的构建缓存保存到 `buildcache-base` 标签。
  这是内部构建缓存，不是可运行的发行版本。
- Dockerfile 先安装系统库和 Python 依赖，再复制代码、写入提交号；
  只修改代码或提交号时可以复用依赖层。
- 同一提交重复发布会直接复用已有正式镜像，并验证索引、启动服务；
  程序更新且索引格式兼容时复用已发布索引。
- `data` 更新发现远端 PBF 版本未变时，不下载 PBF、不生成索引、不发布新镜像。
- 缓存缺失或被清理会正常重建；缓存导出失败只影响后续速度，不影响已验证的镜像发布。
  原始 PBF 不占用 Actions 持久化缓存。
- 连续执行两次时，查看测试镜像的 `CACHED`、缓存导入/导出和正式镜像复用日志；
  第二次整体更快也可能来自“跳过正式镜像构建”，不能全部归因于分层缓存。

### 全量容器实测（2026-09-22）

在独立测试服务器上，以 2 核、8 GiB 限额顺序生成，使用的数据快照日期为 2026-09-20。
两国均完成索引生成、内置镜像构建和网页启动验证。

| 区域 | 索引大小 | gzip 大小 | 纯解析耗时 | 构建内存峰值 | 网页空闲内存 |
| --- | --- | --- | --- | --- | --- |
| 中国 | 283 MiB | 76 MiB | 6 分 12 秒 | 6.8 GiB | 2.8 GiB |
| 日本 | 129 MiB | 27 MiB | 6 分 30 秒 | 4.2 GiB | 1.2 GiB |

构建内存峰值读取自 cgroup，包含文件缓存，与日志中的解析子进程峰值 RSS 不同。
网页采用单 worker，空闲内存不代表复杂寻路时的峰值；启动时会将全部索引加载为 Python 对象。
这些数值只代表该服务器，不能推算 GitHub Actions 的网络速度或总耗时。
每日更新需按上文手动启用。
