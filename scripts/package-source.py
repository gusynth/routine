"""Build a public source ZIP by allowlist, never by copying the working folder."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    'package.json', 'package-lock.json', 'server.js', 'README.md', 'LICENSE',
    'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md',
    '.gitignore', '.gitattributes', '.nvmrc', 'desktop/App.cs',
    'desktop/WindowFrame.xaml', 'desktop/RoutineDesktop.csproj', 'desktop/LauncherBootstrap.cs',
    'scripts/build.js', 'scripts/build-scene.js', 'scripts/build-static.js',
    'scripts/package-source.py', 'scripts/prepare-development.ps1', 'scripts/backup-local.js',
    'scripts/preview-server.js', 'scripts/measure-runtime.js', 'scripts/build-install-payload.ps1', 'scripts/build-installer.ps1',
    'scripts/build-installer-web.cjs', 'scripts/build-installer-preview.ps1',
)
DIRECTORIES = ('lib', 'public', 'assets', 'test', '.github', 'docs', 'desktop/controller', 'installer')
FORBIDDEN = {'database.json', 'backups', '.runtime', 'node_modules', '.git', 'logos',
             'artifacts', 'releases', '__pycache__', '.env', '.private', 'bin', 'obj', 'app', 'dev'}


def sources(root=ROOT):
    selected = {root / name for name in FILES}
    for name in DIRECTORIES:
        directory = root / name
        if not directory.is_dir():
            raise ValueError(f'Missing source directory: {name}')
        selected.update(p for p in directory.rglob('*') if p.is_file() and not any(part in FORBIDDEN for part in p.relative_to(root).parts))
    for file in sorted(selected):
        relative = file.relative_to(root)
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            raise ValueError(f'Invalid source: {relative}')
        if any(part in FORBIDDEN or part.startswith('.env') for part in relative.parts):
            raise ValueError(f'Private or generated path in source: {relative}')
        if file.suffix in {'.pyc', '.log', '.tmp'}:
            raise ValueError(f'Generated file in source: {relative}')
        yield relative.as_posix(), file.read_bytes()


def package(output=None):
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    output = Path(output) if output else ROOT / 'releases' / f'Routine-{version}-source.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = list(sources())
    manifest = {'name': 'routine', 'version': version, 'type': 'public-source',
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in payload}}
    prefix = f'routine-{version}/'
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in payload:
            # Fixed metadata makes the same source produce the same archive.
            info = zipfile.ZipInfo(prefix + name, date_time=(2026, 11, 16, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
        info = zipfile.ZipInfo(prefix + 'RELEASE-MANIFEST.json', date_time=(2026, 11, 16, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, json.dumps(manifest, indent=2).encode('utf-8'))
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    print(json.dumps({'archive': str(output), 'files': len(payload), 'bytes': output.stat().st_size, 'sha256': digest}))
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    package(parser.parse_args().output)
