"""Prepare a versioned build and verify the exact VSIX before promotion."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from xml.etree import ElementTree
from zipfile import ZipFile


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def validate_version(version):
    if not isinstance(version, str) or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version):
        raise ValueError('Enter a version such as 0.5.0 (three numbers, no v prefix).')
    return version


def prepare(root, version):
    validate_version(version)
    package = read_json(root / 'package.json')
    old_filename = f"{package['name']}-{package['version']}.vsix"
    package['version'] = version
    write_json(root / 'package.json', package)
    lock = read_json(root / 'package-lock.json')
    lock['version'] = version
    lock['packages']['']['version'] = version
    write_json(root / 'package-lock.json', lock)
    readme = root / 'README.md'
    readme.write_text(readme.read_text().replace(old_filename, f"{package['name']}-{version}.vsix"))


def manifest(root, directory, provenance):
    package = read_json(root / 'package.json')
    version = validate_version(package['version'])
    filename = f"{package['name']}-{version}.vsix"
    digest = hashlib.sha256((directory / filename).read_bytes()).hexdigest()
    record = dict(provenance, version=version, filename=filename, sha256=digest,
                  name=package['name'], publisher=package['publisher'])
    write_json(directory / 'build.json', record)
    (directory / 'SHA256SUMS').write_text(f'{digest}  {filename}\n')
    return record


def verify(directory, expected):
    record = read_json(directory / 'build.json')
    version = validate_version(record['version'])
    for key, value in expected.items():
        if record.get(key) != value:
            raise ValueError(f'Build {key} does not match the selected workflow run.')
    filename = f"scripta-language-support-{version}.vsix"
    if record['filename'] != filename:
        raise ValueError('Unexpected VSIX filename.')
    if sorted(path.name for path in directory.iterdir()) != sorted([filename, 'build.json', 'SHA256SUMS']):
        raise ValueError('Build must contain exactly one VSIX, build.json, and SHA256SUMS.')
    digest = hashlib.sha256((directory / filename).read_bytes()).hexdigest()
    if record['sha256'] != digest or (directory / 'SHA256SUMS').read_text() != f'{digest}  {filename}\n':
        raise ValueError('VSIX checksum does not match the saved build.')
    with ZipFile(directory / filename) as archive:
        package = json.loads(archive.read('extension/package.json'))
        identity = ElementTree.fromstring(archive.read('extension.vsixmanifest')).find(
            './/{http://schemas.microsoft.com/developer/vsx-schema/2011}Identity')
    for key, value in [('version', version), ('name', 'scripta-language-support'), ('publisher', 'trafficinc')]:
        if package.get(key) != value or record.get(key) != value:
            raise ValueError(f'Packaged {key} does not match build metadata.')
    if identity is None or any(identity.get(key) != value for key, value in [
        ('Version', version), ('Id', 'scripta-language-support'), ('Publisher', 'trafficinc')
    ]):
        raise ValueError('VSIX identity does not match build metadata.')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'manifest', 'verify'])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--directory', type=Path, default=Path('dist'))
    parser.add_argument('--version')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.root, args.version)
        return
    provenance = {
        'repository': os.environ['GITHUB_REPOSITORY'],
        'commit': os.environ['BUILD_COMMIT'],
        'run_id': os.environ['BUILD_RUN_ID'],
        'run_attempt': os.environ['BUILD_RUN_ATTEMPT'],
    }
    record = manifest(args.root, args.directory, provenance) if args.command == 'manifest' else verify(args.directory, provenance)
    if output := os.environ.get('GITHUB_OUTPUT'):
        with open(output, 'a') as stream:
            for key in ['version', 'filename', 'run_attempt']:
                stream.write(f'{key}={record[key]}\n')
    print(f"Verified {record['filename']} ({record['sha256']})")


if __name__ == '__main__':
    main()
