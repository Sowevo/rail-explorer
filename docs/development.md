# 源码运行与开发

[返回首页](../README.md)

以下命令在克隆后的项目根目录执行。

## 安装

需要 Python 3.9+。以下命令适用于 macOS/Linux；前端样式、地图底图和在线地名搜索需要网络。

```bash
git clone https://github.com/Sowevo/rail-explorer.git
cd "rail-explorer"
python3 -m venv ".venv"
source ".venv/bin/activate"
python -m pip install -r "requirements.txt"
```

下文命令均在项目根目录、已激活的虚拟环境中执行。

## 准备地图数据

### 获取 PBF 下载地址

打开 [Geofabrik 下载站](https://download.geofabrik.de/)，按洲、国家或地区找到需要的数据，复制 `.osm.pbf` 文件链接，而不是 `.html` 详情页地址。

常用地址：

| 区域 | 下载链接 |
| --- | --- |
| 中国 | [china-latest.osm.pbf](https://download.geofabrik.de/asia/china-latest.osm.pbf) |
| 日本 | [japan-latest.osm.pbf](https://download.geofabrik.de/asia/japan-latest.osm.pbf) |
| 其他地区 | 在 [Geofabrik](https://download.geofabrik.de/) 中选择区域，部分国家还提供更小范围的数据 |

### 生成索引：两种方式任选其一

**方式一：传入链接，自动下载并生成索引。**

```bash
python "app/parse_osm.py" "https://download.geofabrik.de/asia/japan-latest.osm.pbf"
```

无需 aria2，支持多连接下载、断点续传和重定向。下载中断后重新执行同一命令即可。

**方式二：自己下载，再传入本地文件路径。**

```bash
python "app/parse_osm.py" "/实际路径/地图.osm.pbf"
```

本地文件直接读取，不复制或删除原文件。两种方式都必须传入参数，没有默认数据源。

每次解析一个 PBF，覆盖现有索引，不合并多个文件。更新数据前先停止服务，生成完成后再启动。**已有索引且数据无需更新时，直接跳到[启动与停止](#启动与停止)。**

### 保存位置

| 内容 | 位置 |
| --- | --- |
| 自动下载的 PBF | 系统 Downloads 目录下的 `rail/<链接哈希>/source.osm.pbf` |
| 手动下载的 PBF | 传入的文件路径，位置不变 |
| 生成的索引 | 项目中的 `app/data/` |
| 服务日志 | `app/data/logs/rail.log` |

索引包括 `node_to_ways.pkl`、`way_to_nodes.pkl`、`node_coords.pkl`、`way_to_meta.pkl`、`relations.pkl`、`stations.pkl` 六个文件，分别保存轨道连接、节点、坐标、属性、关系和车站数据。

**生成索引后可以删除原始 PBF。** 保留六份索引即可运行和重启服务；只有更新或重建索引时才需要 PBF。索引、日志和虚拟环境均已由 `.gitignore` 忽略，不上传 Git。

## 启动与停止

在项目目录、已激活的虚拟环境中启动：

```bash
python "app/app.py"
```

浏览器访问 [http://127.0.0.1:5050/](http://127.0.0.1:5050/)。服务自动加载 `app/data/` 中的索引，无需再次导入 PBF。

以后打开新终端时，先进入你保存项目的位置并激活环境，再启动：

```bash
cd "/你的项目路径/rail-explorer"
source ".venv/bin/activate"
python "app/app.py"
```

在服务终端按 `Ctrl+C` 停止；执行 `deactivate` 退出虚拟环境。

## 维护与排查

### 查看日志

日志为普通文本，包含时间、级别、请求编号、操作摘要和错误信息，异常堆栈分行显示。单文件最大 5 MiB，保留 3 份轮转历史。

```bash
tail -f "app/data/logs/rail.log"
```

可用 `request_id` 关联请求，用 `page_id` 关联同一页面的操作。日志不记录 Cookie 或完整行程几何。此前已生成的 JSON 日志不会自动转换。

### 下载细节

下载最多使用 16 个连接，支持 HTTP/HTTPS 重定向。分段文件和 `download.json` 保存在同一下载目录；远端大小及 ETag/Last-Modified 未变时可续传或复用，版本变化则重新下载。

不支持 Range 的服务器使用单连接下载；缺少可靠版本标识时，跨次运行重新下载。分段合并期间需额外容纳一份 PBF 的磁盘空间。系统 Downloads 查询不可用时，回退到用户主目录下的 `Downloads`。

### 常见问题

| 问题 | 处理方式 |
| --- | --- |
| PBF 解析慢或内存占用高 | 优先选择更小区域的数据 |
| 能搜索地点，但附近没有轨道 | 检查该位置是否在当前 PBF 覆盖范围内，以及 OSM 是否标记为支持的轨道类型 |
| 在线地点搜索失败 | 检查网络；可通过 `RAIL_GEOCODER_URL` 配置兼容 Nominatim 的搜索服务 |
| 服务换了索引，旧页面无法继续操作 | 先导出已有行程，再点击“清空”，绑定新数据源 |
| 剪贴板复制失败 | 在“更多”中查看查询内容并手动复制 |

## 开发说明

行程推进、退回、截取、分支推荐和 KML 生成均在浏览器完成。Flask 提供本地索引查询、在线地名搜索代理和诊断记录，不保存行程会话。轨道数据按需加载，在当前页面内存中复用。

```text
rail-explorer/
├── README.md
├── requirements.txt
├── app/
│   ├── app.py                 # Flask 入口
│   ├── parse_osm.py           # PBF 解析与索引生成
│   ├── pbf_download.py        # 多连接下载与续传
│   ├── diagnostics.py         # 日志与诊断
│   ├── nearby.py              # 附近轨道与关系查询
│   ├── geocoding.py           # 在线地名搜索
│   ├── station_*.py           # 车站索引与地图展示
│   ├── stations.py            # 端点车站建议
│   ├── static/                # 前端行程计算与地图交互
│   ├── templates/index.html   # 页面
│   └── data/                  # 本地索引与日志，不入 Git
└── tests/                     # Python 与前端算法测试
```
