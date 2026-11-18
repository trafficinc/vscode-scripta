"""Exercise the artifact boundary before allowing a release to be created."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[1] / 'scripts/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / 'dist'
        self.directory.mkdir()
        self.provenance = {'repository': 'trafficinc/vscode-scripta', 'commit': 'a' * 40,
                           'run_id': '123', 'run_attempt': '2'}
        self.package = {'name': 'scripta-language-support', 'version': '0.4.0', 'publisher': 'trafficinc'}
        release.write_json(self.root / 'package.json', self.package)
        release.write_json(self.root / 'package-lock.json', {'version': '0.4.0', 'packages': {'': {'version': '0.4.0'}}})
        (self.root / 'README.md').write_text('Install scripta-language-support-0.4.0.vsix')

    def build(self, manifest_version='0.5.0'):
        release.prepare(self.root, '0.5.0')
        filename = self.directory / 'scripta-language-support-0.5.0.vsix'
        with ZipFile(filename, 'w') as archive:
            archive.writestr('extension/package.json', (self.root / 'package.json').read_text())
            archive.writestr('extension.vsixmanifest',
                '<PackageManifest xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">'
                f'<Metadata><Identity Id="scripta-language-support" Version="{manifest_version}" Publisher="trafficinc"/>'
                '</Metadata></PackageManifest>')
        release.manifest(self.root, self.directory, self.provenance)
        return filename

    def test_entered_version_is_applied_to_package_lock_and_install_instructions(self):
        self.build()
        self.assertEqual(release.read_json(self.root / 'package.json')['version'], '0.5.0')
        lock = release.read_json(self.root / 'package-lock.json')
        self.assertEqual(lock['version'], '0.5.0')
        self.assertEqual(lock['packages']['']['version'], '0.5.0')
        self.assertIn('0.5.0.vsix', (self.root / 'README.md').read_text())
        self.assertEqual(release.verify(self.directory, self.provenance)['version'], '0.5.0')

    def test_invalid_versions_do_not_modify_the_checkout(self):
        for version in [None, '', 'v0.5.0', '01.5.0', '1.0', '1.0.0-beta', '../bad', '1.0.0\nfilename=bad']:
            with self.subTest(version=version), self.assertRaises(ValueError):
                release.prepare(self.root, version)
            self.assertEqual(release.read_json(self.root / 'package.json')['version'], '0.4.0')

    def test_workflow_outputs_preserve_the_original_build_attempt(self):
        self.build()
        output = self.root / 'outputs'
        env = dict(os.environ, GITHUB_REPOSITORY=self.provenance['repository'],
                   BUILD_COMMIT=self.provenance['commit'], BUILD_RUN_ID='123',
                   BUILD_RUN_ATTEMPT='2', GITHUB_OUTPUT=str(output))
        result = subprocess.run([sys.executable, str(Path(release.__file__)), 'verify',
                                 '--directory', str(self.directory)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_text().splitlines(),
                         ['version=0.5.0', 'filename=scripta-language-support-0.5.0.vsix', 'run_attempt=2'])

    def test_changed_artifact_and_checksums_are_rejected(self):
        filename = self.build()
        filename.write_bytes(filename.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            release.verify(self.directory, self.provenance)

    def test_modified_checksum_file_is_rejected(self):
        self.build()
        (self.directory / 'SHA256SUMS').write_text('wrong checksum')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            release.verify(self.directory, self.provenance)

    def test_wrong_run_attempt_commit_or_repository_is_rejected(self):
        self.build()
        for key in self.provenance:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                release.verify(self.directory, dict(self.provenance, **{key: 'different'}))

    def test_wrong_embedded_package_version_is_rejected_even_with_valid_checksum(self):
        self.build()
        with ZipFile(self.directory / 'scripta-language-support-0.5.0.vsix', 'w') as archive:
            archive.writestr('extension/package.json', json.dumps(self.package))
            archive.writestr('extension.vsixmanifest', '<PackageManifest/>')
        release.manifest(self.root, self.directory, self.provenance)
        with self.assertRaisesRegex(ValueError, 'Packaged version'):
            release.verify(self.directory, self.provenance)

    def test_wrong_vsix_manifest_identity_is_rejected(self):
        self.build(manifest_version='0.4.0')
        with self.assertRaisesRegex(ValueError, 'VSIX identity'):
            release.verify(self.directory, self.provenance)

    def test_unexpected_artifact_contents_are_rejected(self):
        self.build()
        (self.directory / 'unexpected.vsix').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'exactly one VSIX'):
            release.verify(self.directory, self.provenance)

    def test_path_traversal_in_artifact_filename_is_rejected(self):
        self.build()
        record = release.read_json(self.directory / 'build.json')
        record['filename'] = '../outside.vsix'
        release.write_json(self.directory / 'build.json', record)
        with self.assertRaisesRegex(ValueError, 'filename'):
            release.verify(self.directory, self.provenance)


if __name__ == '__main__':
    unittest.main()
