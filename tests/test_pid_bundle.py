import json
from pathlib import Path
import tempfile
import unittest

from scripts.check_pid_bundle import verify


class BundleChecks(unittest.TestCase):
    def create_bundle(self, root: Path) -> None:
        (root / 'days/2026-11-08/routes').mkdir(parents=True)
        (root / 'days/2026-11-08/routes/a.json').write_text('{}')
        (root / 'days/2026-11-08/trips.json').write_text('{}')
        (root / 'days/2026-11-08/blocks.json').write_text('{}')
        (root / 'manifest.json').write_text(json.dumps({
            'schema': 'casovac-pid-v1',
            'days': {'2026-11-08': {'available': True, 'buckets': 0}}
        }))

    def test_accepts_small_complete_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_bundle(root)
            self.assertGreater(verify(root)['files'], 1)

    def test_rejects_oversized_shard(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_bundle(root)
            (root / 'days/2026-11-08/routes/a.json').write_bytes(b'X' * (5 * 1024 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, 're-shard'):
                verify(root)


if __name__ == '__main__':
    unittest.main()
