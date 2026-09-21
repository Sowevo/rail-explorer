# Rail Explorer

在地图上选择铁路轨道、规划行程，并导出 KML。基于 OpenStreetMap 本地数据，支持铁路、地铁、轻轨和单轨铁路。

## 快速开始

先安装并启动 Docker，下面三种方式任选一种。镜像支持 amd64 和 arm64，无需克隆代码或安装 Python。

### 1. 中国地区

```bash
docker run -d --name rail-explorer \
  -p 5050:5050 --restart unless-stopped \
  ghcr.io/sowevo/rail-explorer:china
```

已内置中国索引，无需另外下载地图或生成索引。打开 [http://localhost:5050](http://localhost:5050)。

### 2. 日本地区

```bash
docker run -d --name rail-explorer \
  -p 5050:5050 --restart unless-stopped \
  ghcr.io/sowevo/rail-explorer:japan
```

已内置日本索引，无需另外下载地图或生成索引。打开 [http://localhost:5050](http://localhost:5050)。

### 3. 其他地区

下面以**西班牙**为例。其他地区可在 [Geofabrik](https://download.geofabrik.de/) 选择，替换命令中的 `.osm.pbf` 下载链接。

**第一步：下载并生成索引。**

```bash
mkdir -p "./data"
docker run --rm -it \
  -v "$PWD/data:/data" \
  ghcr.io/sowevo/rail-explorer:latest \
  index "https://download.geofabrik.de/europe/spain-latest.osm.pbf"
```

**第二步：完成后，在同一目录启动网页。**

```bash
docker run -d --name rail-explorer \
  -p 5050:5050 --restart unless-stopped \
  -v "$PWD/data:/data" \
  ghcr.io/sowevo/rail-explorer:latest
```

打开 [http://localhost:5050](http://localhost:5050)。数据保存在当前目录的 `data/` 中，以后启动无需重新生成索引。一个数据目录对应一个地区。

> 命令适用于 macOS / Linux 终端。三种方式共用容器名和端口；切换地区前需停止并移除旧容器，参见[更新与切换](docs/docker.md#更新程序或内置数据)。在服务器上运行时，将 `localhost` 换成服务器地址。

## 开始规划行程

1. 搜索地点，或移动地图到目标位置。
2. 在地图上右键查询附近轨道，查看线路关系后开始探索。
3. 选择相连轨道继续，可退回、换乘和调整起终点。
4. 点击“下载 KML”保存行程。

**行程保存在当前页面内存中，刷新或关闭页面前请先导出。** 地图底图和地点搜索需要网络；轨道数据只覆盖所用索引的地区。

## 更多说明

- [使用说明](docs/usage.md)：分支选择、沿关系继续、跨线连接、起终点截取。
- [Docker 数据管理与发布](docs/docker.md)：本地 PBF、更新镜像和索引、固定版本、Actions 与缓存。
- [源码运行与开发](docs/development.md)：不使用 Docker 的安装方式、日志和常见问题。
- [功能清单](docs/FEATURES.md)：完整功能与使用边界。

地图数据来自 OpenStreetMap，由 Geofabrik 提供下载。© OpenStreetMap contributors，遵循 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。
