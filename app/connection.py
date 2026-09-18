"""无状态跨线寻路：完整索引在后端，行程及确认仍由页面持有。"""

import heapq
import itertools
import math
from stations import distance

MAX_ROLLBACK = 10
MAX_DISTANCE = 50000
MAX_STATES = 50000


class ConnectionPlanner:
    def __init__(self, ways, coords, metadata, node_ways, diagnostic=lambda *a, **k: None):
        self.ways, self.coords, self.metadata, self.node_ways = ways, coords, metadata, node_ways
        self.diagnostic = diagnostic
        self.raw_cache = {}
        self.distance_limited = False

    def raw(self, wid):
        if wid not in self.raw_cache:
            nodes = self.ways.get(wid, ())
            if len(nodes) < 2 or any(n not in self.coords for n in nodes):
                raise ValueError('这条轨道缺少完整坐标，无法计算行程。')
            self.raw_cache[wid] = [self.coords[n] for n in nodes]
        return self.raw_cache[wid]

    @staticmethod
    def interpolate(points, position):
        index = min(math.floor(position), len(points) - 2)
        ratio = position - index
        return [points[index][axis] + ratio * (points[index + 1][axis] - points[index][axis]) for axis in (0, 1)]

    def line(self, item):
        points = self.raw(item['way_id'])
        if item.get('span') is None:
            return points
        start, end = item['span']
        low, high = sorted((start, end))
        result = [self.interpolate(points, low)]
        result.extend(points[i] for i in range(math.floor(low) + 1, math.ceil(high)))
        result.append(self.interpolate(points, high))
        return result if start < end else result[::-1]

    def kept_nodes(self, item):
        ns = self.ways[item['way_id']]
        low, high = sorted(item.get('span') or [0, len(ns) - 1])
        return ns[math.ceil(low):math.floor(high) + 1]

    def track(self, item):
        span = item.get('span')
        return {'id': item['way_id'], 'coords': self.line(item),
                'reversed': bool(span and span[1] < span[0]), 'meta': self.metadata.get(item['way_id'], {})}

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('请提供连接参数。')
        target, tail = payload.get('target_way'), payload.get('tail')
        if type(target) is not int or target not in self.ways:
            raise ValueError('请选择有效的目标轨道。')
        if not isinstance(tail, list) or not 1 <= len(tail) <= MAX_ROLLBACK + 1:
            raise ValueError('请提供最多 11 条末尾轨道。')
        cleaned = []
        for item in tail:
            if not isinstance(item, dict) or type(item.get('way_id')) is not int or item['way_id'] not in self.ways:
                raise ValueError('末尾轨道无效。')
            span = item.get('span')
            if span is not None and (not isinstance(span, list) or len(span) != 2 or
                    any(type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= len(self.ways[item['way_id']]) - 1 for p in span) or span[0] == span[1]):
                raise ValueError('轨道保留范围无效。')
            self.raw(item['way_id'])
            cleaned.append({'way_id': item['way_id'], 'span': span})
        if cleaned[-1]['span'] is None:
            raise ValueError('请先选择下一条轨道或指定起点，确认行进方向。')
        constraints = []
        for key, maximum in [('blocked_nodes', 1000000), ('used_way_ids', 100000)]:
            values = payload.get(key)
            if not isinstance(values, list) or len(values) > maximum or any(type(n) is not int or n <= 0 for n in values):
                raise ValueError('已走过的轨道约束无效。')
            constraints.append(set(values))
        blocked, selected = constraints
        selected.update(item['way_id'] for item in cleaned)
        if target in selected:
            raise ValueError('目标轨道已在当前行程中，请选择尚未加入的轨道。')
        self.raw(target)
        return target, cleaned, blocked, selected

    def preview(self, payload):
        target, tail, prefix_nodes, selected = self.validate(payload)
        starts = [(rollback, tail[:len(tail) - rollback]) for rollback in range(len(tail))
                  if tail[len(tail) - rollback - 1]['span'] is not None]
        limited = False
        for rollback, retained in starts:
            route = self.search(retained, {target}, prefix_nodes)
            if route:
                return self.plan(target, tail, rollback, retained, route)
            limited |= self.distance_limited
        candidates, offsets = self.corridor(target)
        candidates -= selected | {target}
        if candidates:
            for rollback, retained in starts:
                route = self.search(retained, candidates, prefix_nodes)
                if route:
                    result = self.plan(target, tail, rollback, retained, route)
                    item = route['items'][-1]
                    point = self.line(item)[0]
                    node = self.ways[item['way_id']][int(item['span'][0])]
                    original = self.raw(target)
                    original_point = self.project(original, point)
                    angle = math.degrees(math.atan2((point[1] - original_point[1]) * math.cos(math.radians(point[0])), point[0] - original_point[0]))
                    direction = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][math.floor((angle + 360) / 45 + .5) % 8]
                    result['recommendation'] = {'way_id': item['way_id'], 'point': point, 'original_point': original_point,
                        'original_track': self.track({'way_id': target}), 'offset_m': offsets[node], 'direction': direction}
                    self.diagnostic('connection_recommended', target_way=target, connected_way=item['way_id'], offset_m=offsets[node], rollback=rollback)
                    return result
                limited |= self.distance_limited
        for _, retained in starts:
            if self.search(retained, {target}, prefix_nodes, allow_turns=True):
                raise ValueError('本地轨道有连接，但找到的路径需要明显折返，无法顺向接到所选位置；同线连续范围内也未找到可推荐的汇入点。请另选目标轨道，原行程未改变。')
            limited |= self.distance_limited
        reason = '已达到 50 公里搜索范围，无法确认更远处是否有连接' if limited else '在本地数据中未找到符合当前方向的连接'
        raise ValueError(f'未找到连接路径：{reason}（已尝试回退 {len(tail) - 1} 条轨道）。请另选目标位置，原行程未改变。')

    def plan(self, target, tail, rollback, retained, route):
        items = route['items']
        self.diagnostic('connection_found', target_way=target, connected_way=items[-1]['way_id'], rollback=rollback,
                        added=len(items), distance_m=route['distance'])
        return {'target_way': target, 'connected_way': items[-1]['way_id'], 'rollback': rollback,
                'retained_span': retained[-1]['span'], 'items': items,
                'tracks': [self.track(item) for item in items],
                'removed_tracks': [self.track(item) for item in tail[len(retained):]], 'distance_m': route['distance']}

    @staticmethod
    def project(points, point):
        cosine, best = math.cos(math.radians(point[0])), None
        for a, b in zip(points, points[1:]):
            dx, dy = (b[1] - a[1]) * cosine, b[0] - a[0]
            length = dx * dx + dy * dy
            if not length:
                continue
            t = max(0, min(1, ((point[1] - a[1]) * cosine * dx + (point[0] - a[0]) * dy) / length))
            projected = [a[i] + t * (b[i] - a[i]) for i in (0, 1)]
            metres = distance(point, projected)
            if best is None or metres < best[0]:
                best = (metres, projected)
        return best[1] if best else list(points[0])

    def corridor(self, target):
        tags = self.metadata.get(target, {}).get('tags', {})
        ways, visited = {target}, {target}
        target_nodes = self.ways[target]
        offsets = dict.fromkeys(target_nodes, 0)

        def same_line(wid):
            other = self.metadata.get(wid, {}).get('tags', {})
            return bool(tags.get('name') or tags.get('ref')) and other.get('railway') == tags.get('railway') and (
                other.get('name') == tags['name'] if tags.get('name') else other.get('ref') == tags.get('ref')) and (
                not tags.get('ref') or other.get('ref') == tags['ref'])

        for initial in (target_nodes[0], target_nodes[-1]):
            current, node, metres = target, initial, 0
            while len(visited) < 1000 and metres < MAX_DISTANCE:
                following = [wid for wid in self.node_ways.get(node, ()) if wid != current and same_line(wid)]
                if len(following) != 1 or following[0] in visited:
                    break
                wid = following[0]
                ns = self.ways[wid]
                self.raw(wid)
                if node not in (ns[0], ns[-1]) or any(any(other != wid and same_line(other) for other in self.node_ways.get(n, ())) for n in ns[1:-1]):
                    break
                oriented = ns if ns[0] == node else ns[::-1]
                lengths = [distance(self.coords[a], self.coords[b]) for a, b in zip(oriented, oriented[1:])]
                if metres + sum(lengths) > MAX_DISTANCE:
                    break
                for i, n in enumerate(oriented):
                    if i:
                        metres += lengths[i - 1]
                    offsets[n] = min(offsets.get(n, math.inf), metres)
                visited.add(wid)
                ways.add(wid)
                current, node = wid, oriented[-1]
        return ways, offsets

    def search(self, path, targets, prefix_nodes, allow_turns=False):
        self.distance_limited = False
        last = path[-1]
        start, exit_position = last['span']
        direction = 1 if exit_position > start else -1
        blocked = prefix_nodes | {n for item in path for n in self.kept_nodes(item)}
        source = self.ways[last['way_id']][int(exit_position)] if float(exit_position).is_integer() else None
        heap, distances, sequence = [], {}, itertools.count()

        def push(state):
            key = state['wid'], state['index'], state['direction']
            if distances.get(key, math.inf) <= state['distance']:
                return
            distances[key] = state['distance']
            heapq.heappush(heap, (state['distance'], next(sequence), state))

        push({'wid': last['way_id'], 'index': exit_position, 'direction': direction, 'distance': 0, 'previous': None, 'edge': None})
        expanded = 0
        while heap:
            _, _, state = heapq.heappop(heap)
            if state['distance'] != distances[(state['wid'], state['index'], state['direction'])]:
                continue
            expanded += 1
            if expanded > MAX_STATES:
                raise ValueError('附近轨道过于复杂，已停止寻路；请靠近跨线位置后重试，原行程未改变。')
            ns = self.ways[state['wid']]
            node = ns[int(state['index'])] if float(state['index']).is_integer() else None
            if state['wid'] in targets and state['edge'] and state['index'] in (0, len(ns) - 1):
                edges, previous = [], state
                while previous['edge']:
                    edges.append(previous['edge'])
                    previous = previous['previous']
                items = []
                for edge in reversed(edges):
                    if items and items[-1]['way_id'] == edge['way_id'] and items[-1]['span'][1] == edge['span'][0]:
                        items[-1]['span'][1] = edge['span'][1]
                    else:
                        items.append({'way_id': edge['way_id'], 'span': list(edge['span'])})
                return {'items': items, 'distance': state['distance']}
            neighbors = sorted({state['wid']} | set(self.node_ways.get(node, ())))
            for wid in neighbors:
                if state['wid'] in targets and wid != state['wid']:
                    continue
                way = self.ways[wid]
                self.raw(wid)
                positions = [state['index']] if wid == state['wid'] else [i for i, n in enumerate(way) if n == node]
                for position in positions:
                    for step in (-1, 1):
                        if wid == state['wid'] and step != state['direction']:
                            continue
                        end = math.floor(position) + 1 if step > 0 else math.ceil(position) - 1
                        if not 0 <= end < len(way):
                            continue
                        first = end
                        if wid != state['wid'] and not allow_turns:
                            incoming = self.line(state['edge'] or last)
                            outgoing = self.line({'way_id': wid, 'span': [position, first]})
                            a, b, c = incoming[-2], incoming[-1], outgoing[1]
                            cosine = math.cos(math.radians(b[0]))
                            dx, dy, ex, ey = (b[1] - a[1]) * cosine, b[0] - a[0], (c[1] - b[1]) * cosine, c[0] - b[0]
                            if dx * ex + dy * ey < -.5 * math.hypot(dx, dy) * math.hypot(ex, ey):
                                continue
                        while 0 < end < len(way) - 1 and len(self.node_ways.get(way[end], ())) == 1:
                            end += step
                        previous, loops = state, False
                        while previous:
                            if float(previous['index']).is_integer() and self.ways[previous['wid']][int(previous['index'])] == way[end]:
                                loops = True
                                break
                            previous = previous['previous']
                        if loops:
                            continue
                        traversed = [way[i] for i in range(first, end + step, step)]
                        if any(n in blocked or n == source for n in traversed) or len(set(traversed)) != len(traversed):
                            continue
                        item = {'way_id': wid, 'span': [position, end]}
                        points = self.line(item)
                        length = sum(distance(a, b) for a, b in zip(points, points[1:]))
                        metres = state['distance'] + length
                        if metres > MAX_DISTANCE:
                            self.distance_limited = True
                            continue
                        if length < 1e-6:
                            continue
                        push({'wid': wid, 'index': end, 'direction': step, 'distance': metres, 'previous': state, 'edge': item})
        return None
