import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parents[2]


class DeploymentTests(unittest.TestCase):
    def test_image_is_pinned_and_worker_user_is_non_root(self):
        dockerfile = (ROOT / "Dockerfile").read_text()
        self.assertIn(
            "@sha256:0df934a22e4e893cf15e7aeaf35c463ecc75937758a83099aefdc13041619a1d",
            dockerfile,
        )
        self.assertIn("USER 1000:1000", dockerfile)
        self.assertIn('ENTRYPOINT ["python3", "-m", "kfs_sandbox"]', dockerfile)
        self.assertIn('version("unstructured") == "0.22.18"', dockerfile)

    def test_override_hard_limits_apply_only_to_existing_dedicated_service(self):
        override = (
            REPOSITORY / "docker/knowledge-fs-unstructured-sandbox.compose.yaml"
        ).read_text()
        self.assertIn("  knowledge_fs_unstructured:", override)
        self.assertNotIn("\n  unstructured:", override)
        for expected in (
            "read_only: true",
            "pids_limit: 192",
            "init: true",
            "size=1073741824",
            "no-new-privileges:true",
        ):
            self.assertIn(expected, override)


if __name__ == "__main__":
    unittest.main()
