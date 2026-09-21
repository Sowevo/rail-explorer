"""发布失败不能推进程序指针；每日更新按国家独立恢复。"""
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('rail_release', Path(__file__).resolve().parents[1] / 'scripts/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def invoke(self, mode):
        revision = 'a' * 40
        def command(*args, **kwargs):
            if args[:2] == ('git', 'rev-parse'):
                return revision
            if args[:2] == ('docker', 'inspect'):
                return 'ghcr.io/example/rail@sha256:abc'
        def country(repository, base, commit, region, mode):
            self.assertEqual(commit, revision)
            self.assertIn('@sha256:', base)
            if region == 'china':
                raise RuntimeError('生成失败')
            return 'ghcr.io/example/rail:japan-fixed'
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'Example/Rail'}), \
             patch.object(sys, 'argv', ['release', '--mode', mode]), \
             patch.object(release, 'run', side_effect=command), \
             patch.object(release, 'exists', return_value=True), \
             patch.object(release, 'country', side_effect=country), \
             patch.object(release, 'promote') as promote:
            with self.assertRaisesRegex(RuntimeError, '生成失败'):
                release.main()
            return promote.call_args_list

    def test_program_failure_keeps_all_short_tags(self):
        self.assertEqual(self.invoke('program'), [])

    def test_data_failure_does_not_block_other_country_or_change_program(self):
        calls = self.invoke('data')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].args[1], 'japan')

    def test_registry_network_error_is_not_treated_as_missing_tag(self):
        import subprocess
        result = subprocess.CompletedProcess([], 1, '', 'TLS handshake timeout')
        with patch.object(release.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, '停止发布'):
                release.exists('example:fixed')

    def test_first_package_denied_requires_authenticated_confirmation(self):
        import subprocess
        result = subprocess.CompletedProcess([], 1, '', 'denied')
        with patch.object(release.subprocess, 'run', return_value=result):
            with patch.object(release, 'package_missing', return_value=True):
                self.assertFalse(release.exists('example:fixed'))
            with patch.object(release, 'package_missing', return_value=False):
                with self.assertRaises(RuntimeError):
                    release.exists('example:fixed')
