# Rail Explorer · 铁路轨迹编辑与 KML 导出工具

基于 OpenStreetMap 铁路数据，在地图上选取轨道、沿线路推进，绘制火车、高铁和地铁行程。支持多段行程、换乘、跨线连接和起终点截取，并导出 KML 轨迹文件。

可用于补录乘车路线、保存旅行轨迹，以及在支持 KML 的地图应用中查看和使用。可为**世界迷雾（Fog of World）**补全未记录或漏记的铁路轨迹。

*Edit railway journeys on OpenStreetMap and export KML tracks for Fog of World and other KML-compatible map applications.*

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

## 绘制铁路轨迹并导出 KML

1. 搜索地点，或移动地图到目标位置。
2. 在地图上右键查询附近轨道，查看线路关系后开始探索。
3. 选择相连轨道继续，可退回、换乘和调整起终点。
4. 点击“下载 KML”保存轨迹文件。

**行程保存在当前页面内存中，刷新或关闭页面前请先导出。** 地图底图和地点搜索需要网络；轨道数据只覆盖所用索引的地区。

## 应用场景：世界迷雾轨迹补录

乘车时未开启轨迹记录、GPS 信号中断，或想补录过去的铁路行程，可以沿实际乘坐的线路绘制轨迹，导出 KML 后，通过世界迷雾的文件导入功能补充足迹。[世界迷雾（Fog of World）支持 KML 和 GPX 轨迹导入](https://fogofworld.app/zh-hans/)。

导出的 KML 也可用于其他支持该格式的地图或 GIS 工具，具体显示和导入方式以目标应用为准。

## 常见问题

### 可以补录高铁、火车或地铁的漏记轨迹吗？

可以根据乘坐的线路，手动选取并补录缺失路段，再导出 KML。生成的是基于铁路地图还原的路线，不会恢复原始 GPS 记录，也不会自动识别某趟列车实际经过的站内轨道。

### 支持 GPX 导出吗？

目前提供 KML 导出，暂不提供 GPX 导出。

## 更多说明

- [使用说明](docs/usage.md)：分支选择、沿关系继续、跨线连接、起终点截取。
- [Docker 数据管理与发布](docs/docker.md)：本地 PBF、更新镜像和索引、固定版本、Actions 与缓存。
- [源码运行与开发](docs/development.md)：不使用 Docker 的安装方式、日志和常见问题。
- [功能清单](docs/FEATURES.md)：完整功能与使用边界。

地图数据来自 OpenStreetMap，由 Geofabrik 提供下载。© OpenStreetMap contributors，遵循 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。
