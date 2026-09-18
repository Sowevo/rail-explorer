"""后端连接寻路的方向、回退、推荐和请求边界。"""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from connection import ConnectionPlanner


def planner(ways, points=None):
    coords, adjacency = {}, {}
    for wid, ns in ways.items():
        for n in ns:
            coords[n] = (points or {}).get(n, (35, 139 + n * .001))
            adjacency.setdefault(n, set()).add(wid)
    return ConnectionPlanner(ways, coords, {wid: {'tags': {'name': '测试'}} for wid in ways}, adjacency)


def payload(p, ids, target, spans=None):
    items = []
    for i, wid in enumerate(ids):
        ns = p.ways[wid]
        span = (spans or {}).get(i)
        if span is None:
            neighbor = ids[i - 1] if i else ids[i + 1] if len(ids) > 1 else None
            shared = [n for n in (ns[0], ns[-1]) if n in p.ways.get(neighbor, ())]
            if len(shared) == 1:
                span = [0, len(ns) - 1] if (shared[0] == ns[0]) == bool(i) else [len(ns) - 1, 0]
        items.append({'way_id': wid, 'span': span})
    prefix = items[:-11]
    return {'target_way': target, 'tail': items[-11:],
            'blocked_nodes': list({n for item in prefix for n in p.kept_nodes(item)}), 'used_way_ids': ids}


class ConnectionTests(unittest.TestCase):
    def test_shortest_forward_and_midway_connection(self):
        p = planner({1:[1,2], 2:[2,3], 3:[3,4,5], 4:[4,6], 5:[6,7], 9:[3,20,6]})
        result = p.preview(payload(p, [1,2], 5))
        self.assertEqual(result['rollback'], 0)
        self.assertEqual(result['items'], [{'way_id':3,'span':[0,1]}, {'way_id':4,'span':[0,1]}, {'way_id':5,'span':[0,1]}])
        self.assertNotIn('retained', result)
        self.assertEqual(result['tracks'][-1]['id'], 5)

    def test_rollback_ten_allowed_eleven_refused(self):
        p = planner({**{i:[i,i+1] for i in range(1,13)}, 20:[2,20]})
        result = p.preview(payload(p, list(range(1,12)), 20))
        self.assertEqual(result['rollback'], 10)
        self.assertEqual(len(result['removed_tracks']), 10)
        with self.assertRaisesRegex(ValueError, '回退 10'):
            p.preview(payload(p, list(range(1,13)), 20))

    def test_keep_existing_route_before_shorter_rollback(self):
        p = planner({1:[1,2],2:[2,3],3:[3,20],4:[20,5],5:[5,6],9:[2,5]}, {20:(35.0003,139.004)})
        result = p.preview(payload(p, [1,2], 5))
        self.assertEqual(result['rollback'], 0)
        self.assertEqual([x['way_id'] for x in result['items']], [3,4,5])

    def test_partial_reverse_and_missed_midpoint(self):
        p = planner({1:[1,2,3],2:[3,4],3:[4,5]})
        result = p.preview(payload(p, [1], 3, {0:[0,.5]}))
        self.assertEqual(result['items'][0], {'way_id':1,'span':[.5,2]})
        reverse = p.preview(payload(p, [3], 1, {0:[1,0]}))
        self.assertEqual([x['span'] for x in reverse['items']], [[1,0],[2,0]])
        p = planner({1:[1,2],2:[2,3],3:[3,4,5],9:[4,6],10:[6,7]})
        result = p.preview(payload(p, [1,2,3], 10))
        self.assertEqual(result['rollback'], 1)
        self.assertEqual(result['items'][0], {'way_id':3,'span':[0,1]})

    def recommended(self, branch=False):
        p = planner({1:[1,2],2:[2,3],3:[3,6],10:[4,5],11:[5,6],12:[6,7], **({13:[6,8]} if branch else {})})
        for wid in [10,11,12] + ([13] if branch else []):
            p.metadata[wid]['tags'] = {'name':'目标线','ref':'R','railway':'rail'}
        return p

    def test_recommendation_and_branch_boundary(self):
        p = self.recommended()
        result = p.preview(payload(p, [1,2], 10))
        self.assertEqual(result['target_way'], 10)
        self.assertEqual(result['connected_way'], 12)
        self.assertEqual(result['recommendation']['point'], list(p.coords[6]))
        self.assertTrue(80 < result['recommendation']['offset_m'] < 100)
        p = self.recommended(True)
        self.assertEqual(p.corridor(10)[0], {10,11})
        with self.assertRaisesRegex(ValueError, '需要明显折返'):
            p.preview(payload(p, [1,2], 10))

    def test_no_crossing_different_line_identity_or_midpoint_branch(self):
        p = self.recommended()
        p.metadata[11]['tags']['ref'] = 'other'
        self.assertEqual(p.corridor(10)[0], {10})
        p.metadata[10]['tags'] = {'railway':'rail'}
        self.assertEqual(p.corridor(10)[0], {10})
        p = planner({10:[1,2],11:[2,3,4],12:[3,5]})
        self.assertEqual(p.corridor(10)[0], {10})

    def test_prefix_nodes_and_used_ways_are_respected(self):
        p = planner({1:[1,2],2:[2,3],3:[3,4]})
        data = payload(p, [1,2], 3)
        data['blocked_nodes'] = [4]
        with self.assertRaisesRegex(ValueError, '未找到'):
            p.preview(data)
        data['used_way_ids'].append(3)
        with self.assertRaisesRegex(ValueError, '已在'):
            p.preview(data)

    def test_direction_distance_and_bad_payload(self):
        p = planner({1:[1,2],2:[2,3],9:[3,4]}, {4:(36,139)})
        with self.assertRaisesRegex(ValueError, '方向'):
            p.preview(payload(p, [1], 9))
        with self.assertRaisesRegex(ValueError, '50 公里'):
            p.preview(payload(p, [1,2], 9))
        valid = payload(p, [1,2], 9)
        for changed in [{'tail':valid['tail']*6}, {'target_way':True}, {'blocked_nodes':[True]},
                        {'tail':[{'way_id':1,'span':[0,math.nan]}]}, {'tail':[{'way_id':1,'span':[0,9]}]},
                        {'tail':[{'way_id':1,'span':[0,0]}]}, {'used_way_ids':'all'}]:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                p.preview({**valid, **changed})
