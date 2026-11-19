"""Check administrator previews using real local Git revisions."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SOURCE_DIR", ".")
os.environ.setdefault("SITE_ROOT", ".")
import worker


class ReleaseNotesTests(unittest.TestCase):
    def test_exact_range_missed_releases_and_unknown_version(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(worker, "SOURCE", Path(folder)):
            def git(*args):
                return subprocess.check_output(["git", "-C", folder, *args], encoding="utf-8").strip()
            git("init", "-q")
            file = Path(folder, worker.NOTES_FILE)
            file.parent.mkdir()
            def revision(ids):
                entries = [dict(id=i, title=i, changes=["Изменение"], verify=["Проверка"]) for i in ids]
                file.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
                git("add", worker.NOTES_FILE)
                git("-c","user.name=Test","-c","user.email=test@invalid","commit","-qm","notes")
                return git("rev-parse", "HEAD")
            first = revision(["one"])
            revision(["two", "one"])
            last = revision(["three", "two", "one"])
            pending = worker.release_notes(first, last)
            self.assertEqual(pending["scope"], "pending")
            self.assertEqual([n["id"] for n in pending["items"]], ["three","two"])
            self.assertEqual(worker.release_notes(last, last)["items"][0]["verify"], ["Проверка"])
            self.assertEqual(worker.release_notes(None, last)["scope"], "latest")
            bad = revision(["bad","bad"])
            self.assertEqual(worker.release_notes(first, bad), {"scope":"unavailable","items":[]})


if __name__ == "__main__":
    unittest.main()
