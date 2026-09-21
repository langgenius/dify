from __future__ import annotations

import base64
import io
import json
import os
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

import check_image_resources as checker
from PIL import Image
from PIL.PngImagePlugin import PngInfo


def png(*, optimized: bool = False) -> bytes:
    image = Image.new("RGBA", (80, 80), (20, 80, 120, 140))
    output = io.BytesIO()
    image.save(output, format="PNG", compress_level=9 if optimized else 0)
    return output.getvalue()


def png16(color_type: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color_type]
    header = struct.pack(">IIBBBBB", 80, 80, 16, color_type, 0, 0, 0)
    pixels = (b"\0" + b"\x12\x34" * channels * 80) * 80
    return (
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels, 0)) + chunk(b"IEND", b"")
    )


def svg(data: bytes, href: str = "xlink:href") -> bytes:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'width="80" height="80" viewBox="0 0 80 80">'
        f'<image width="80" height="80" {href}="data:image/png;base64,{base64.b64encode(data).decode()}"/>'
        "</svg>"
    ).encode()


class ImageOptimizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, name: str, data: bytes) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_threshold_is_strictly_greater_than_25_percent(self):
        self.assertFalse(checker.exceeds_threshold(100, 75))
        self.assertTrue(checker.exceeds_threshold(100, 74))
        self.assertFalse(checker.exceeds_threshold(100, 110))

    def test_uncompressed_png_fails_and_candidate_preserves_pixels_and_dimensions(self):
        original = png()
        path = self.write("web/public/test.png", original)
        status, _, candidate = checker.inspect_image("web/public/test.png", self.root)
        self.assertEqual(status, "error")
        self.assertIsNotNone(candidate)
        with Image.open(io.BytesIO(original)) as before, Image.open(io.BytesIO(candidate)) as after:
            self.assertEqual(before.size, after.size)
            self.assertEqual(before.convert("RGBA").tobytes(), after.convert("RGBA").tobytes())
        self.assertEqual(path.read_bytes(), original)
        path.write_bytes(candidate)
        self.assertEqual(checker.inspect_image("web/public/test.png", self.root)[0], "passed")

    def test_large_already_optimized_png_passes_without_byte_cap(self):
        image = Image.frombytes("RGB", (512, 512), random.Random(0).randbytes(512 * 512 * 3))
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        self.assertGreater(len(output.getvalue()), 512000)
        self.write("web/public/large.png", output.getvalue())
        self.assertEqual(checker.inspect_image("web/public/large.png", self.root)[0], "passed")

    def test_png_color_metadata_is_preserved(self):
        metadata = PngInfo()
        metadata.add(b"gAMA", (45455).to_bytes(4, "big"))
        metadata.add(b"sRGB", b"\0")
        output = io.BytesIO()
        Image.new("RGB", (20, 20), "red").save(output, format="PNG", pnginfo=metadata)
        candidate, _ = checker.compress_raster(output.getvalue())
        with Image.open(io.BytesIO(candidate)) as image:
            self.assertEqual(image.info["gamma"], 0.45455)
            self.assertEqual(image.info["srgb"], 0)

    def test_svg_embedded_png_is_actually_compressed_for_both_href_forms(self):
        for href in ["href", "xlink:href"]:
            self.write("web/public/icon.svg", svg(png(), href))
            status, message, candidate = checker.inspect_image("web/public/icon.svg", self.root)
            self.assertEqual(status, "error")
            self.assertIn("embedded PNG", message)
            root = ET.fromstring(candidate)
            self.assertEqual(root.attrib["viewBox"], "0 0 80 80")
            image = root.find(".//{http://www.w3.org/2000/svg}image")
            self.assertEqual((image.attrib["width"], image.attrib["height"]), ("80", "80"))

    def test_16_bit_pngs_are_skipped_and_embedded_payloads_preserved(self):
        for color_type in [0, 2, 4, 6]:
            with self.subTest(color_type=color_type):
                original = png16(color_type)
                candidate, method = checker.compress_raster(original)
                self.assertEqual(candidate, original)
                self.assertIn("skipped: 16-bit PNG", method)
                self.write("web/public/high-depth.png", original)
                status, _, candidate = checker.inspect_image("web/public/high-depth.png", self.root)
                self.assertEqual(status, "skipped")
                self.assertIsNone(candidate)
                candidate, method = checker.compress_svg(svg(original))
                self.assertIn("embedded skipped: 16-bit PNG", method)
                element = ET.fromstring(candidate).find(".//{http://www.w3.org/2000/svg}image")
                href = element.get("href", element.get("{http://www.w3.org/1999/xlink}href"))
                self.assertEqual(base64.b64decode(href.split(",", 1)[1]), original)

    def test_embedded_base64_whitespace_and_xml_entities_are_optimized(self):
        original = png()
        encoded = base64.b64encode(original).decode()
        payloads = [
            "\n".join(encoded[i : i + 64] for i in range(0, len(encoded), 64)),
            "\r\n\t".join(encoded[i : i + 64] for i in range(0, len(encoded), 64)),
            "&#10;".join(encoded[i : i + 64] for i in range(0, len(encoded), 64)),
            "&#105;" + encoded[1:],
        ]
        for href_name in ["href", "xlink:href"]:
            for payload in payloads:
                with self.subTest(href=href_name, payload_prefix=payload[:80]):
                    source = svg(original, href_name).replace(encoded.encode(), payload.encode())
                    self.write("web/public/wrapped.svg", source)
                    status, message, candidate = checker.inspect_image("web/public/wrapped.svg", self.root)
                    self.assertEqual(status, "error")
                    self.assertIn("embedded PNG", message)
                    element = ET.fromstring(candidate).find(".//{http://www.w3.org/2000/svg}image")
                    href = element.get("href", element.get("{http://www.w3.org/1999/xlink}href"))
                    compressed = base64.b64decode(href.split(",", 1)[1])
                    self.assertLess(len(compressed), len(original) / 4)
                    with Image.open(io.BytesIO(compressed)) as after, Image.open(io.BytesIO(original)) as before:
                        self.assertEqual(after.tobytes(), before.tobytes())
                    self.write("web/public/wrapped.svg", candidate)
                    self.assertEqual(checker.inspect_image("web/public/wrapped.svg", self.root)[0], "passed")

    def test_svg_external_raster_reference_is_not_fetched_or_embedded(self):
        data = b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/image.png"/></svg>'
        result, _ = checker.compress_svg(data)
        self.assertIn(b"https://example.invalid/image.png", result)
        self.assertNotIn(b"data:image", result)

    def test_css_svgs_are_skipped_without_changing_any_bytes(self):
        cases = [
            b'<style>g {opacity:0.5}</style><g><rect width="100" height="100"/></g>',
            b'<rect style="fill:black" width="80" height="80"/>',
            b'<link rel="stylesheet" href="style.css"/><rect width="80" height="80"/>',
        ]
        sources = [b'<svg xmlns="http://www.w3.org/2000/svg">' + body + b"\n    " * 80 + b"</svg>" for body in cases]
        sources += [
            b'<svg xmlns="http://www.w3.org/2000/svg" style="fill:black"><rect width="80" height="80"/></svg>',
            b'<?xml-stylesheet href="style.css" type="text/css"?><svg xmlns="http://www.w3.org/2000/svg"/>',
            svg(png()).replace(b"<image", b"<style>image {opacity:0.5}</style><image"),
        ]
        for source in sources:
            with self.subTest(source=source[:100]):
                candidate, method = checker.compress_svg(source)
                self.assertEqual(candidate, source)
                self.assertIn("skipped: SVG contains CSS", method)
                self.write("images/styled.svg", source)
                self.assertEqual(checker.inspect_image("images/styled.svg", self.root)[0], "skipped")

    def test_fix_preserves_inline_style_precedence_over_stylesheet(self):
        self.run_git("init", "-q")
        originals = {}
        for color in ["blue", "black"]:
            source = (
                b'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">'
                b"<style>rect {fill:red}</style>"
                + b"\n    " * 80
                + f'<rect style="fill:{color}" width="80" height="80"/></svg>'.encode()
            )
            originals[self.write(f"images/{color}.svg", source)] = source
        self.run_git("add", ".")
        scripts = self.root / "scripts/image-resources"
        scripts.mkdir(parents=True)
        shutil.copy(checker.__file__, scripts / "check_image_resources.py")
        (scripts / "ignore.json").write_text("[]")
        result = subprocess.run(
            [sys.executable, str(scripts / "check_image_resources.py"), "--all", "--fix"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 skipped", result.stdout)
        self.assertIn("0 fixed", result.stdout)
        for path, source in originals.items():
            self.assertEqual(path.read_bytes(), source)

    def test_svg_markup_is_optimized(self):
        data = (
            b'<svg xmlns="http://www.w3.org/2000/svg">' + b"\n        " * 100 + b'<rect width="10" height="10"/></svg>'
        )
        candidate, _ = checker.compress_svg(data)
        self.assertTrue(checker.exceeds_threshold(len(data), len(candidate)))

    def test_lossy_trials_are_labelled_and_preserve_dimensions(self):
        for fmt in ["JPEG", "WEBP"]:
            output = io.BytesIO()
            Image.new("RGB", (80, 60), (20, 80, 120)).save(output, format=fmt)
            candidate, method = checker.compress_raster(output.getvalue())
            self.assertIn("lossy", method)
            with Image.open(io.BytesIO(candidate)) as image:
                self.assertEqual(image.size, (80, 60))

    def test_animated_images_are_reported_as_skipped(self):
        frames = [Image.new("RGB", (10, 10), color) for color in ["red", "blue"]]
        output = io.BytesIO()
        frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
        self.write("web/public/animated.gif", output.getvalue())
        status, message, candidate = checker.inspect_image("web/public/animated.gif", self.root)
        self.assertEqual(status, "skipped")
        self.assertIn("animated", message)
        self.assertIsNone(candidate)

    def test_empty_corrupt_and_invalid_embedded_images_fail(self):
        for name, data in [
            ("empty.png", b""),
            ("corrupt.png", b"not a PNG"),
            ("bad.svg", b"<svg>"),
            ("bad.svg", b'<svg><image href="data:image/png;base64,%%%"/></svg>'),
        ]:
            name = "web/public/" + name
            self.write(name, data)
            self.assertEqual(checker.inspect_image(name, self.root)[0], "error")

    def test_symlinks_are_not_followed(self):
        target = self.write("outside.png", png())
        link = self.root / "web/public/link.png"
        link.parent.mkdir(parents=True)
        link.symlink_to(target)
        self.assertIn("symlinks", checker.inspect_image("web/public/link.png", self.root)[1])

    def test_workflow_command_characters_are_escaped(self):
        value = checker.escape_annotation("image,prop:x%\r\n::error::injected")
        for literal in ["\n", "\r", ",", ":"]:
            self.assertNotIn(literal, value)

    def run_git(self, *args: str) -> str:
        return checker.git(*args, root=self.root).decode().strip()

    def test_ignore_rules_validate_and_match_repository_relative_globs(self):
        config = self.write("scripts/image-resources/ignore.json", b"[]")
        self.assertEqual(checker.load_ignore_rules(self.root), [])
        rules = [
            {"pattern": "logo.png", "reason": "Keep upstream original"},
            {"pattern": "fixtures/*.png", "reason": "Encoding test fixtures"},
        ]
        config.write_text(json.dumps(rules))
        loaded = checker.load_ignore_rules(self.root)
        for name in ["logo.png", "fixtures/test.png", "fixtures/nested/test.png"]:
            self.assertIsNotNone(checker.ignored_reason(name, loaded))
        for name in ["other/logo.png", "logo.PNG", "fixtures/test.svg"]:
            self.assertIsNone(checker.ignored_reason(name, loaded))
        for invalid in [
            {},
            ["*.png"],
            [{"pattern": "*.png"}],
            [{"pattern": "*.png", "reason": " "}],
            [{"pattern": "/logo.png", "reason": "test"}],
            [{"pattern": "../logo.png", "reason": "test"}],
        ]:
            config.write_text(json.dumps(invalid))
            with self.assertRaises(ValueError):
                checker.load_ignore_rules(self.root)

    def test_ignore_applies_to_check_fix_and_candidate_export(self):
        self.run_git("init", "-q")
        original = png()
        path = self.write("fixtures/keep.png", original)
        self.run_git("add", ".")
        scripts = self.root / "scripts/image-resources"
        scripts.mkdir(parents=True)
        shutil.copy(checker.__file__, scripts / "check_image_resources.py")
        config = scripts / "ignore.json"
        config.write_text(json.dumps([{"pattern": "fixtures/*.png", "reason": "Preserve encoding fixture"}]))
        command = [sys.executable, str(scripts / "check_image_resources.py"), "--all"]
        with tempfile.TemporaryDirectory() as output:
            summary = Path(output) / "summary.md"
            env = {**os.environ, "GITHUB_ACTIONS": "true", "GITHUB_STEP_SUMMARY": str(summary)}
            for args in [[], ["--fix"], ["--output-dir", output]]:
                result = subprocess.run(command + args, env=env, capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("1 ignored", result.stdout)
                self.assertIn("Preserve encoding fixture", result.stdout)
                self.assertEqual(path.read_bytes(), original)
                self.assertFalse((Path(output) / "fixtures/keep.png").exists())
            self.assertIn("**ignored**", summary.read_text())
            self.assertIn("Preserve encoding fixture", summary.read_text())
        config.write_text("[]")
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        config.write_text("invalid json")
        result = subprocess.run(command + ["--fix"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Invalid image ignore configuration", result.stderr)
        self.assertEqual(path.read_bytes(), original)

    def test_fix_cli_applies_candidates_and_preserves_other_files(self):
        self.run_git("init", "-q")
        originals = {
            "web/public/fix.png": png(),
            "web/public/fix.svg": svg(png()),
            "web/public/passed.png": png(optimized=True),
            "web/public/broken.png": b"invalid image",
            "web/public/high-depth.png": png16(6),
        }
        for name, data in originals.items():
            self.write(name, data)
        self.run_git("add", ".")
        scripts = self.root / "scripts/image-resources"
        scripts.mkdir(parents=True)
        shutil.copy(checker.__file__, scripts / "check_image_resources.py")
        (scripts / "ignore.json").write_text("[]")
        command = [sys.executable, str(scripts / "check_image_resources.py"), "--all"]
        result = subprocess.run(command + ["--fix"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("2 fixed", result.stdout)
        self.assertIn("Review all modified images visually", result.stdout)
        for name in ["web/public/fix.png", "web/public/fix.svg"]:
            self.assertLess((self.root / name).stat().st_size, len(originals[name]))
            self.assertEqual(checker.inspect_image(name, self.root)[0], "passed")
        for name in ["web/public/passed.png", "web/public/broken.png", "web/public/high-depth.png"]:
            self.assertEqual((self.root / name).read_bytes(), originals[name])
        self.run_git("rm", "-f", "web/public/broken.png")
        fixed = {name: (self.root / name).read_bytes() for name in originals if "broken" not in name}
        for arguments in [[], ["--fix"]]:
            result = subprocess.run(command + arguments, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("0 fixed", result.stdout)
            for name, data in fixed.items():
                self.assertEqual((self.root / name).read_bytes(), data)
        result = subprocess.run(
            command + ["--fix", "--output-dir", "/tmp/candidates"], capture_output=True, text=True, check=False
        )
        self.assertEqual(result.returncode, 2)

    def test_git_selection_cli_exit_summary_and_candidate_artifact(self):
        self.run_git("init", "-q")
        self.run_git("config", "user.email", "test@example.invalid")
        self.run_git("config", "user.name", "Image checker test")
        self.write("web/public/untouched.png", png())
        self.write("web/public/deleted.png", png())
        self.write("web/public/renamed.png", png(optimized=True))
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "base")
        base = self.run_git("rev-parse", "HEAD")
        self.run_git("rm", "web/public/deleted.png")
        unusual_name = "web/public/renamed , image\n.png"
        self.run_git("mv", "web/public/renamed.png", unusual_name)
        self.write("web/public/added.svg", svg(png()))
        self.write("images/docs.png", png())
        self.write("api/fixtures/asset.PNG", png(optimized=True))
        self.write("logo.png", png(optimized=True))
        self.write("docs/readme.md", b"not an image")
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "changes")
        self.assertEqual(
            checker.image_paths(base, self.root),
            ["api/fixtures/asset.PNG", "images/docs.png", "logo.png", "web/public/added.svg", unusual_name],
        )
        scripts = self.root / "scripts/image-resources"
        scripts.mkdir(parents=True)
        shutil.copy(checker.__file__, scripts / "check_image_resources.py")
        (scripts / "ignore.json").write_text("[]")
        command = [sys.executable, str(scripts / "check_image_resources.py"), "--base", base]
        with tempfile.TemporaryDirectory() as output:
            env = {**os.environ, "GITHUB_ACTIONS": "true", "GITHUB_STEP_SUMMARY": str(Path(output) / "summary.md")}
            result = subprocess.run(
                command + ["--output-dir", output], cwd=self.root, env=env, capture_output=True, text=True, check=False
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn("::error file=web/public/added.svg::", result.stdout)
            self.assertNotIn("untouched.png", result.stdout)
            candidate = Path(output) / "web/public/added.svg"
            self.assertTrue(candidate.exists())
            self.assertIn("No fixed byte limits", (Path(output) / "summary.md").read_text())
            shutil.copy(candidate, self.root / "web/public/added.svg")
            self.assertIn("::error file=images/docs.png::", result.stdout)
            shutil.copy(Path(output) / "images/docs.png", self.root / "images/docs.png")
        result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(command[:-2] + ["--all"], cwd=self.root, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("untouched.png", result.stdout)
        result = subprocess.run(command + ["--output-dir", str(self.root)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("outside the repository", result.stderr)


if __name__ == "__main__":
    unittest.main()
