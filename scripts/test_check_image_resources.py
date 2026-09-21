from __future__ import annotations

import base64
import copy
import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote_from_bytes

import check_image_resources as checker


def svg(*payloads: bytes, href: str = "xlink:href") -> bytes:
    images = "".join(
        f'<image {href}="data:image/png;base64,{base64.b64encode(payload).decode()}"/>' for payload in payloads
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">{images}</svg>'.encode()


class ImageBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = checker.load_config(checker.CONFIG)

    def write(self, name: str, data: bytes) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_embedded_payload_catches_the_original_small_svg_problem(self):
        name = "web/app/options.svg"
        self.write(name, svg(b"x" * 27349))
        failures, _ = checker.inspect_image(name, self.config, self.root)
        self.assertEqual(len(failures), 1)
        self.assertIn("embedded-raster-bytes", failures[0])
        self.write(name, svg(b"x" * 2061))
        self.assertEqual(checker.inspect_image(name, self.config, self.root), ([], []))

    def test_embedded_budget_sums_images_and_supports_both_href_forms(self):
        for href in ["href", "xlink:href"]:
            path = self.write("web/public/multiple.svg", svg(b"a" * 9000, b"b" * 9000, href=href))
            self.assertEqual(checker.image_sizes(path)["embedded-raster-bytes"], 18000)

    def test_percent_encoded_raster_is_counted_without_fetching_external_images(self):
        data = bytes(range(256))
        path = self.write(
            "web/public/encoded.svg",
            f'<svg><image href="data:image/png,{quote_from_bytes(data)}"/>'
            '<image href="https://example.invalid/image.png"/></svg>'.encode(),
        )
        self.assertEqual(checker.image_sizes(path)["embedded-raster-bytes"], len(data))

    def test_repetitive_vector_markup_uses_gzip_instead_of_raw_size(self):
        path = self.write("web/public/grid.svg", b"<svg>" + b'<rect width="1" height="1"/>' * 10000 + b"</svg>")
        self.assertGreater(path.stat().st_size, self.config["limits"]["svg-gzip-bytes"])
        self.assertEqual(checker.inspect_image("web/public/grid.svg", self.config, self.root), ([], []))

    def test_exact_budget_passes_and_one_byte_over_fails(self):
        name = "web/public/photo.webp"
        limit = self.config["limits"]["raster-bytes"]
        self.write(name, b"x" * limit)
        self.assertEqual(checker.inspect_image(name, self.config, self.root), ([], []))
        self.write(name, b"x" * (limit + 1))
        self.assertEqual(len(checker.inspect_image(name, self.config, self.root)[0]), 1)

    def test_whole_svg_budget_is_independent_of_embedded_budget(self):
        data = b"<svg><!--" + base64.b64encode(os.urandom(60000)) + b"--></svg>"
        self.assertGreater(len(gzip.compress(data)), self.config["limits"]["svg-gzip-bytes"])
        self.write("web/public/large.svg", data)
        failures, _ = checker.inspect_image("web/public/large.svg", self.config, self.root)
        self.assertEqual(len(failures), 1)
        self.assertIn("svg-gzip-bytes", failures[0])

    def test_malformed_svg_or_embedded_base64_fails_inspection(self):
        for data in [b"<svg>", b'<svg><image href="data:image/png;base64,%%%"/></svg>']:
            self.write("web/public/bad.svg", data)
            failures, _ = checker.inspect_image("web/public/bad.svg", self.config, self.root)
            self.assertIn("Unable to inspect", failures[0])

    def test_symlinks_are_not_followed(self):
        target = self.write("outside.png", b"x")
        link = self.root / "web/public/link.png"
        link.parent.mkdir(parents=True)
        link.symlink_to(target)
        self.assertIn("symlinks", checker.inspect_image("web/public/link.png", self.config, self.root)[0][0])

    def test_exemption_applies_only_to_its_file_and_rule(self):
        name = "web/public/large.svg"
        self.write(name, svg(os.urandom(70000)))
        self.config["exceptions"][name] = {"embedded-raster-bytes": "Required detailed illustration"}
        failures, exemptions = checker.inspect_image(name, self.config, self.root)
        self.assertEqual(len(failures), 1)
        self.assertIn("svg-gzip-bytes", failures[0])
        self.assertEqual(len(exemptions), 1)
        self.assertIn("Required detailed illustration", exemptions[0])

    def test_invalid_exemption_reasons_and_rules_are_rejected(self):
        for exemption in [{"raster-bytes": " "}, {"typo": "Needed"}]:
            config = copy.deepcopy(self.config)
            config["exceptions"]["web/public/test.png"] = exemption
            path = self.write("config.json", json.dumps(config).encode())
            with self.assertRaises(ValueError):
                checker.load_config(path)

    def test_workflow_command_characters_are_escaped(self):
        value = checker.escape_annotation("image,prop:x%\r\n::error::injected")
        for literal in ["\n", "\r", ",", ":"]:
            self.assertNotIn(literal, value)

    def run_git(self, *args: str) -> str:
        return checker.git(*args, root=self.root).decode().strip()

    def test_changed_files_and_cli_exit_status(self):
        self.run_git("init", "-q")
        self.run_git("config", "user.email", "test@example.invalid")
        self.run_git("config", "user.name", "Image checker test")
        self.write("web/public/untouched.png", b"x" * 600000)
        self.write("web/public/deleted.png", b"x")
        self.write("web/public/renamed.png", b"x" * 100)
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "base")
        base = self.run_git("rev-parse", "HEAD")
        self.run_git("rm", "web/public/deleted.png")
        unusual_name = "web/public/renamed , image\n.png"
        self.run_git("mv", "web/public/renamed.png", unusual_name)
        self.write("web/public/added.svg", svg(b"x" * 27349))
        self.write("images/docs.png", b"x" * 600000)
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "changes")
        self.assertEqual(checker.image_paths(base, self.root), ["web/public/added.svg", unusual_name])
        scripts = self.root / "scripts"
        scripts.mkdir()
        shutil.copy(checker.__file__, scripts / "check_image_resources.py")
        shutil.copy(checker.CONFIG, scripts / "image-resource-budgets.json")
        command = [sys.executable, str(scripts / "check_image_resources.py"), "--base", base]
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("embedded-raster-bytes", result.stdout)
        self.assertNotIn("untouched.png", result.stdout)
        self.write("web/public/added.svg", svg(b"x" * 2061))
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(command[:-2] + ["--all"], cwd=self.root, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("untouched.png", result.stdout)


if __name__ == "__main__":
    unittest.main()
