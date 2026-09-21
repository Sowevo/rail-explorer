"""完整生成、失败保留与运行中锁定同一代索引的回归测试。"""
import fcntl
import json
import os
import pickle
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from container_cli import generate
from index_store import INDEX_FILES, resolve_index, validate_index
from pbf_fixture import write_pbf


class IndexStoreTests(unittest.TestCase):
    def test_generation_is_atomic_and_old_data_survives_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'data'
            pbf = Path(temp) / 'fixture.osm.pbf'
            write_pbf(pbf)
            with patch.dict(os.environ, {}, clear=False):
                generate(str(pbf), root, 'japan')
                first = resolve_index(root)
                self.assertEqual(validate_index(first)['way_to_nodes.pkl'], 1)
                meta = json.loads((first / 'metadata.json').read_text())
                self.assertEqual(meta['data_date'], '2026-09-10')
                self.assertEqual(meta['region'], 'japan')
                with patch('container_cli.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'parser')):
                    with self.assertRaises(subprocess.CalledProcessError):
                        generate(str(pbf), root)
                self.assertEqual(resolve_index(root), first)
                self.assertEqual(len(list((root / 'indexes').iterdir())), 1)
                generate(str(pbf), root, 'china')
                self.assertNotEqual(resolve_index(root), first)
                self.assertFalse(first.exists())
                self.assertEqual(len(list((root / 'indexes').iterdir())), 1)

    def test_concurrent_generation_rejected_without_touching_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with (root / '.index.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError, '已有索引任务'):
                    generate('missing.pbf', root)
            self.assertFalse((root / 'current').exists())

    def test_incomplete_or_incompatible_index_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(FileNotFoundError):
                validate_index(root)
            for name in INDEX_FILES:
                (root / name).write_bytes(pickle.dumps({1: [1]}))
            (root / 'metadata.json').write_text('{"index_format": 999}')
            with self.assertRaisesRegex(ValueError, '不兼容'):
                validate_index(root)

    def test_legacy_directory_still_resolves(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(resolve_index(temp), Path(temp))
