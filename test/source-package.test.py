"""Exercise the public packaging path without touching personal records."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('package_source', ROOT / 'scripts/package-source.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PublicPackage(unittest.TestCase):
    def test_clean_package_integrity_and_reproducibility(self):
        with tempfile.TemporaryDirectory(prefix='routine-source-test-') as temporary:
            first = packager.package(Path(temporary) / 'one.zip')
            second = packager.package(Path(temporary) / 'two.zip')
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                names = archive.namelist()
                prefix = names[0].split('/')[0] + '/'
                manifest = json.loads(archive.read(prefix + 'RELEASE-MANIFEST.json'))
                self.assertEqual(len(names), len(manifest['files']) + 1)
                for name, digest in manifest['files'].items():
                    self.assertFalse(any(p in packager.FORBIDDEN for p in Path(name).parts), name)
                    self.assertEqual(hashlib.sha256(archive.read(prefix + name)).hexdigest(), digest, name)
                self.assertIn(prefix + 'LICENSE', names)
                self.assertIn(prefix + 'public/motion.js', names)
                self.assertIn(prefix + 'desktop/RoutineDesktop.csproj', names)
                self.assertIn(prefix + 'desktop/controller/launcher.ps1', names)
                self.assertIn(prefix + 'installer/Routine.Setup.csproj', names)
                self.assertIn(prefix + 'docs/INSTALLATION.md', names)
                self.assertFalse(any('/.private/' in name or name.endswith('.vbs') for name in names))
                self.assertFalse(any('apply-update.ps1' in name or 'package-update.ps1' in name for name in names))
                self.assertFalse(any(name.endswith(('.dll', '.lnk', '.pyc')) for name in names))


if __name__ == '__main__':
    unittest.main()
