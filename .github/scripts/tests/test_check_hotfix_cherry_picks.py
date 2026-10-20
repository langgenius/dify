"""Exercise the public checker against real local Git commit graphs.

Run with: python3 -m unittest discover -s .github/scripts/tests -v
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parents[1] / "check-hotfix-cherry-picks.sh"


class CherryPickProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="hotfix-provenance-")
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name)
        self.env = os.environ.copy()
        self.env.update(
            {
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_AUTHOR_NAME": "Provenance Test",
                "GIT_AUTHOR_EMAIL": "test@example.invalid",
                "GIT_COMMITTER_NAME": "Provenance Test",
                "GIT_COMMITTER_EMAIL": "test@example.invalid",
            }
        )
        self.git("init", "-b", "main")
        self.base = self.commit("base", "base")
        self.source = self.commit("source", "source")
        self.git("checkout", "-b", "hotfix", self.base)

    def git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo,
            env=self.env,
            text=True,
            capture_output=True,
            check=True,
        )
        return result.stdout.strip()

    def commit(self, name: str, message: str) -> str:
        (self.repo / name).write_text(name + "\n", encoding="utf-8")
        self.git("add", name)
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def check(self, expected: int = 0, **overrides: str) -> str:
        env = (
            self.env
            | {
                "BASE_SHA": self.base,
                "HEAD_SHA": self.git("rev-parse", "HEAD"),
                "MAIN_REF": "main",
            }
            | overrides
        )
        result = subprocess.run(
            ["bash", str(CHECKER)],
            cwd=self.repo,
            env=env,
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def pick(self) -> None:
        self.git("cherry-pick", "-x", self.source)

    def sync_merge(self) -> str:
        self.git("checkout", "-b", "base-update", self.base)
        updated_base = self.commit("base-update", "base maintenance without trailer")
        self.git("checkout", "hotfix")
        self.git("merge", "--no-ff", "base-update", "-m", "Sync base branch")
        return updated_base

    def test_synced_base_merge_does_not_need_provenance(self) -> None:
        self.pick()
        updated_base = self.sync_merge()
        output = self.check(BASE_SHA=updated_base)
        self.assertIn("Verified 1 PR commit(s)", output)

    def test_merge_does_not_hide_invalid_side_branch_commit(self) -> None:
        self.pick()
        self.git("checkout", "-b", "side", self.base)
        self.commit("unproven", "missing provenance on side branch")
        self.git("checkout", "hotfix")
        self.git("merge", "--no-ff", "side", "-m", "Merge side")
        self.assertIn("missing cherry-pick provenance", self.check(expected=1))

    def test_linear_cherry_pick(self) -> None:
        self.pick()
        self.assertIn("Verified 1 PR commit(s)", self.check())

    def test_missing_provenance(self) -> None:
        self.commit("unproven", "missing provenance")
        self.assertIn("missing cherry-pick provenance", self.check(expected=1))

    def test_unavailable_source(self) -> None:
        self.commit(
            "unknown", "unknown source\n\n(cherry picked from commit " + "a" * 40 + ")"
        )
        self.assertIn("not available locally", self.check(expected=1))

    def test_source_not_reachable_from_main(self) -> None:
        self.git("checkout", "-b", "unmerged", self.base)
        source = self.commit("unmerged", "unmerged source")
        self.git("checkout", "hotfix")
        self.git("cherry-pick", "-x", source)
        self.assertIn("not reachable from main", self.check(expected=1))

    def test_empty_range(self) -> None:
        self.assertIn("No PR commits to check", self.check())

    def test_merge_only_range(self) -> None:
        self.git("checkout", "-b", "side", self.base)
        self.commit("side", "side base commit")
        self.git("checkout", "hotfix")
        self.git("merge", "--no-ff", "side", "-m", "Sync base")
        # All side commits are already in the declared base; only merge remains.
        self.assertIn("No PR commits to check", self.check(BASE_SHA="side"))

    def test_missing_environment(self) -> None:
        self.assertIn("are required", self.check(expected=2, BASE_SHA=""))

    def test_unavailable_base(self) -> None:
        self.assertIn("Base commit", self.check(expected=2, BASE_SHA="missing-base"))

    def test_unavailable_head(self) -> None:
        self.assertIn("Head commit", self.check(expected=2, HEAD_SHA="missing-head"))

    def test_unavailable_main(self) -> None:
        self.assertIn("Main ref", self.check(expected=2, MAIN_REF="missing-main"))


if __name__ == "__main__":
    unittest.main()
