"""索引目录与格式约定；修改不兼容的索引结构时递增版本。"""
import json
import pickle
from pathlib import Path

INDEX_FORMAT = 1
INDEX_FILES = ('node_to_ways.pkl', 'way_to_nodes.pkl', 'node_coords.pkl',
               'way_to_meta.pkl', 'relations.pkl', 'stations.pkl')


def resolve_index(root):
    root = Path(root)
    return (root / 'current').resolve() if (root / 'current').exists() else root


def read_metadata(directory):
    path = Path(directory) / 'metadata.json'
    return json.loads(path.read_text()) if path.exists() else {}


def validate_index(directory):
    directory = Path(directory)
    counts = {}
    for name in INDEX_FILES:
        with (directory / name).open('rb') as stream:
            data = pickle.load(stream)
        if not isinstance(data, dict):
            raise ValueError(f'索引格式错误：{name}')
        counts[name] = len(data)
    if not counts['way_to_nodes.pkl'] or not counts['node_coords.pkl']:
        raise ValueError('没有找到可用铁路，保留原索引。')
    metadata = read_metadata(directory)
    if metadata and metadata.get('index_format') != INDEX_FORMAT:
        raise ValueError('索引格式不兼容，请重新生成。')
    return counts
