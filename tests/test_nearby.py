"""验证距离查询、关系成员和PBF关系提取。"""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from nearby import NearbyIndex
from parse_osm import RailRelationHandler
import osmium


class NearbyTests(unittest.TestCase):
    def setUp(self):
        self.ways = {1: [1, 2], 2: [3, 4], 3: [1, 99, 2]}
        self.coords = {1: (35, 139), 2: (35, 139.02),
                       3: (35.001, 139), 4: (35.001, 139.02)}
        self.relations = {
            10: {'tags': {'type': 'route'}, 'members': [
                {'type': 'n', 'ref': 88, 'role': 'stop'},
                {'type': 'w', 'ref': 1, 'role': 'forward'}]},
            11: {'tags': {'type': 'route_master'}, 'members': [
                {'type': 'r', 'ref': 10, 'role': ''},
                {'type': 'r', 'ref': 11, 'role': ''}]},
        }
        self.index = NearbyIndex(self.ways, self.coords,
                                 {wid: {'tags': {}} for wid in self.ways}, self.relations)

    def test_segment_middle_and_distance_order(self):
        result = self.index.query(35, 139.01, 150)
        self.assertEqual([w['id'] for w in result['ways']], [1, 2])
        self.assertLess(result['ways'][0]['distance'], 0.1)
        self.assertAlmostEqual(result['ways'][1]['distance'], 111.2, places=1)
        self.assertEqual([r['id'] for r in result['relations']], [10, 11])

    def test_track_colours_include_line_parents_and_preserve_conflicts(self):
        self.relations[10]['tags'].update(route='train', colour='#ff0000')
        self.relations[11]['tags'].update(route_master='train', colour='#0000ff')
        meta = self.index.track_meta(1)
        self.assertEqual(meta['relation_colours'], ['#0000ff', '#ff0000'])
        self.assertIs(self.index.track_meta(1), meta)
        self.assertEqual(self.index.track_meta(2)['relation_colours'], [])
        self.assertEqual(self.index.detail('way', 1)['geometry_meta'][0]['relation_colours'],
                         meta['relation_colours'])
        self.assertNotIn('relation_colours', self.index.metadata[1])

    def test_track_colours_ignore_station_groups(self):
        self.relations[10]['tags'].update(type='public_transport', colour='#ff0000')
        self.relations[11]['tags'].update(route_master='train', colour='#0000ff')
        self.assertEqual(self.index.track_meta(1)['relation_colours'], [])

    def test_missing_node_does_not_create_false_segment(self):
        self.assertGreater(self.index.distance(3, 35, 139.01), 900)
        self.assertEqual(self.index.detail('way', 3)['geometry'], [])

    def test_empty_and_limited_results(self):
        self.assertEqual(self.index.query(0, 0, 100)['total'], 0)
        result = self.index.query(35.001, 139.01, 150, limit=1)
        self.assertEqual(result['ways'][0]['id'], 2)
        self.assertEqual(result['total'], 2)
        self.assertEqual([r['id'] for r in result['relations']], [10, 11])

    def test_relation_cycle_and_member_order(self):
        detail = self.index.detail('relation', 11)
        self.assertEqual([w['id'] for w in detail['ways']], [1])
        self.assertEqual(len(detail['geometry']), 1)
        members = self.index.detail('relation', 10)['members']
        self.assertEqual([m['ref'] for m in members], [88, 1])
        self.assertEqual(members[1]['role'], 'forward')
        self.assertFalse(members[0]['available'])
        self.assertTrue(members[1]['available'])

    def test_relation_geometry_keeps_each_way_direction_tags(self):
        self.index.metadata[1]['tags']['oneway'] = 'yes'
        self.index.metadata[2]['tags']['oneway'] = '-1'
        self.relations[10]['members'].append({'type':'w','ref':2,'role':''})
        detail = self.index.detail('relation',11)
        self.assertEqual(len(detail['geometry_meta']),len(detail['geometry']))
        self.assertEqual([meta['tags']['oneway'] for meta in detail['geometry_meta']],['yes','-1'])
        self.assertEqual(self.index.detail('way',3)['geometry_meta'],[])

    def test_detail_filters_unused_tags_without_changing_local_index(self):
        tags = {'name':'测试线路', 'colour':'#123456', 'service':'siding',
                'oneway':'yes', 'railway:preferred_direction':'forward',
                'bridge':'yes', 'source':'survey'}
        self.index.metadata[1]['tags'] = tags.copy()
        detail = self.index.detail('way', 1)
        expected = {key:value for key,value in tags.items() if key not in ('bridge', 'source')}
        self.assertEqual(detail['tags'], expected)
        self.assertEqual(detail['geometry_meta'][0]['tags'], expected)
        self.assertEqual(self.index.metadata[1]['tags'], tags)

    def test_direct_memberships_do_not_inherit_parent_direction(self):
        self.relations[10]['tags'].update({'from': 'A', 'to': 'B'})
        self.relations[11]['tags']['from'] = 'Network label'
        way = self.index.detail('way', 1)
        self.assertEqual([r['id'] for r in way['memberships']], [10])
        self.assertEqual(way['memberships'][0]['from'], 'A')
        self.assertEqual(way['memberships'][0]['to'], 'B')
        self.assertEqual(way['memberships'][0]['roles'], ['forward'])
        self.assertEqual([r['id'] for r in self.index.detail('relation', 10)['memberships']], [11])
        self.assertEqual(self.index.detail('way', 2)['memberships'], [])

    def test_connected_relation_scope_and_full_toggle(self):
        self.relations[10]['members'].extend([
            {'type': 'w', 'ref': 2, 'role': ''},
            {'type': 'w', 'ref': 3, 'role': ''}])
        detail = self.index.detail('relation', 10, anchor_way=1)
        self.assertEqual([w['id'] for w in detail['ways']], [1, 3])
        self.assertEqual(detail['scope']['hidden'], 1)
        self.assertEqual(len(detail['members']), 4)
        self.assertEqual(len(detail['geometry_meta']), len(detail['geometry']))
        full = self.index.detail('relation', 10, anchor_way=1, full=True)
        self.assertEqual([w['id'] for w in full['ways']], [1, 2, 3])
        self.assertTrue(full['scope']['full'])
        membership = self.index.detail('way', 1)['memberships'][0]
        self.assertEqual(membership['scope']['hidden'], 1)
        reverse = self.index.detail('relation', 10, anchor_way=2)
        self.assertEqual([w['id'] for w in reverse['ways']], [2])
        self.assertEqual(reverse['scope']['hidden'], 2)
        with self.assertRaises(ValueError):
            self.index.detail('relation', 10, anchor_way=999)

    def test_scope_stays_inside_relation_and_handles_nested_cycle(self):
        self.relations[10]['members'].append({'type': 'w', 'ref': 2, 'role': ''})
        # 关系外的轨道连接两侧，也不能把另一组带入预览。
        self.ways[3] = [2, 3]
        detail = self.index.detail('relation', 11, anchor_way=1)
        self.assertEqual([w['id'] for w in detail['ways']], [1])
        self.assertEqual(detail['scope']['hidden'], 1)
        self.assertNotIn('scope', self.index.detail('relation', 11))

    def test_real_pbf_relation_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'relations.osm.pbf')
            with osmium.SimpleWriter(path) as writer:
                writer.add_relation(osmium.osm.mutable.Relation(id=10, tags={'name': '测试'},
                                    members=[('n', 88, 'stop'), ('w', 1, 'forward')]))
                writer.add_relation(osmium.osm.mutable.Relation(id=11,
                                    members=[('r', 10, ''), ('r', 11, '')]))
                writer.add_relation(osmium.osm.mutable.Relation(id=12, members=[('w', 9, '')]))
            handler = RailRelationHandler()
            with osmium.io.Reader(path, osmium.osm.RELATION) as reader:
                osmium.apply(reader, handler)
            relations = handler.related_to({1})
            self.assertEqual(set(relations), {10, 11})
            self.assertEqual(relations[10]['tags']['name'], '测试')
            self.assertEqual(relations[10]['members'][1]['role'], 'forward')


if __name__ == '__main__':
    unittest.main()
