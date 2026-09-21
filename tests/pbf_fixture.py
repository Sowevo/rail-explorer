"""用于验证完整解析流程的小型 PBF，不依赖外网数据。"""
import osmium


def write_pbf(path, with_track=True):
    header = osmium.io.Header()
    header.set('osmosis_replication_timestamp', '2026-09-10T12:00:00Z')
    with osmium.SimpleWriter(str(path), header=header) as writer:
        writer.add_node(osmium.osm.mutable.Node(id=1, location=(139.76, 35.68),
                                              tags={'railway': 'station', 'name': '测试站'}))
        writer.add_node(osmium.osm.mutable.Node(id=2, location=(139.77, 35.69)))
        if with_track:
            writer.add_way(osmium.osm.mutable.Way(id=10, nodes=[1, 2],
                                                 tags={'railway': 'rail', 'name': '测试线'}))
