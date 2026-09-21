"""Fail when trial compression can reduce a frontend image by more than 25%."""

from __future__ import annotations

import argparse
import base64
import html
import io
import os
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import unquote_to_bytes

from PIL import Image
from PIL.PngImagePlugin import PngInfo
from scour import scour

ROOT = Path(__file__).resolve().parents[2]
PREFIXES = ("web/public/", "web/app/", "packages/iconify-collections/assets/")
IMAGE_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico", ".bmp", ".tif", ".tiff"}
MAX_SAVINGS_PERCENT = 25


def git(*args: str, root: Path = ROOT) -> bytes:
    return subprocess.check_output(["git", *args], cwd=root)


def image_paths(base: str | None, root: Path = ROOT) -> list[str]:
    if base is None:
        output = git("ls-files", "-z", root=root)
    else:
        ancestor = git("merge-base", base, "HEAD", root=root).decode().strip()
        output = git("diff", "--name-only", "--diff-filter=ACMRT", "-z", ancestor, "HEAD", "--", root=root)
    return sorted(
        path
        for path in output.decode().split("\0")
        if path.startswith(PREFIXES) and Path(path).suffix.lower() in IMAGE_EXTENSIONS
    )


def compress_raster(data: bytes) -> tuple[bytes, str]:
    with Image.open(io.BytesIO(data)) as image:
        if getattr(image, "n_frames", 1) != 1:
            return data, "skipped: animated/multi-frame image"
        if image.format not in {"PNG", "JPEG", "WEBP"}:
            return data, f"skipped: no optimizer for {image.format}"
        options = {key: image.info[key] for key in ("icc_profile", "exif", "dpi") if key in image.info}
        output = io.BytesIO()
        if image.format == "PNG":
            # Preserve color interpretation, not only decoded pixel values.
            metadata = PngInfo()
            offset = 8
            while offset + 12 <= len(data):
                length = int.from_bytes(data[offset : offset + 4], "big")
                kind = data[offset + 4 : offset + 8]
                if kind in {b"cHRM", b"cICP", b"gAMA", b"sBIT", b"sRGB"}:
                    metadata.add(kind, data[offset + 8 : offset + 8 + length])
                offset += length + 12
            image.save(output, format="PNG", optimize=True, pnginfo=metadata, **options)
            method = "PNG lossless re-encoding"
        elif image.format == "JPEG":
            image.save(output, format="JPEG", quality=90, optimize=True, progressive=True, **options)
            method = "JPEG quality 90 (lossy; visual review required)"
        else:
            image.save(output, format="WEBP", quality=90, method=6, **options)
            method = "WebP quality 90 (lossy; visual review required)"
        return output.getvalue(), method


def compress_svg(data: bytes) -> tuple[bytes, str]:
    root = ET.fromstring(data)
    if root.tag.rsplit("}", 1)[-1] != "svg":
        raise ValueError("Expected an SVG root element")
    source = data.decode("utf-8")
    methods = ["Scour SVG optimization"]
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "image":
            continue
        href = element.get("href", element.get("{http://www.w3.org/1999/xlink}href", ""))
        header, separator, payload = href.partition(",")
        if not separator or not header.lower().startswith("data:image/"):
            continue
        if header.lower().split(";", 1)[0] == "data:image/svg+xml":
            continue
        raw = unquote_to_bytes(payload)
        if ";base64" in header.lower():
            raw = base64.b64decode(b"".join(raw.split()), validate=True)
        candidate, method = compress_raster(raw)
        if len(candidate) < len(raw):
            # Preserve the original SVG serialization and all image dimensions/transforms.
            replacement = header.split(";", 1)[0] + ";base64," + base64.b64encode(candidate).decode()
            source = source.replace(href, replacement)
            methods.append(f"embedded {method}")
    options = scour.parse_args(["--disable-embed-rasters", "--strip-xml-prolog", "--indent=none", "--no-line-breaks"])
    return scour.scourString(source, options).encode(), "; ".join(dict.fromkeys(methods))


def exceeds_threshold(before: int, after: int) -> bool:
    return (before - after) * 100 > before * MAX_SAVINGS_PERCENT


def inspect_image(name: str, root: Path = ROOT) -> tuple[str, str, bytes | None]:
    path = root / name
    if path.is_symlink():
        return "error", "Image symlinks are not supported; use a regular image file.", None
    try:
        data = path.read_bytes()
        if not data:
            raise ValueError("Image is empty")
        candidate, method = compress_svg(data) if path.suffix.lower() == ".svg" else compress_raster(data)
    except (OSError, ET.ParseError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
        return "error", f"Unable to inspect image: {error}", None
    if method.startswith("skipped:"):
        return "skipped", method, None
    after = min(len(data), len(candidate))
    saving = 100 * (len(data) - after) / len(data)
    message = f"{len(data):,} B → {after:,} B ({saving:.1f}% smaller); {method}"
    if exceeds_threshold(len(data), after):
        return "error", message + ". Review the candidate and optimize this image before merging.", candidate
    return "passed", message, None


def escape_annotation(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A").replace(",", "%2C").replace(":", "%3A")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--base", help="Check images changed between the merge base and HEAD")
    mode.add_argument("--all", action="store_true", help="Audit all tracked frontend images")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--output-dir", type=Path, help="Save failing compression candidates outside the repository")
    action.add_argument(
        "--fix", action="store_true", help="Replace images exceeding 25% savings; review visuals afterward"
    )
    args = parser.parse_args()
    if args.output_dir and args.output_dir.resolve().is_relative_to(ROOT):
        parser.error("--output-dir must be outside the repository to avoid overwriting source images")
    paths = image_paths(args.base)
    results = []
    for name in paths:
        status, message, candidate = inspect_image(name)
        if args.fix and candidate is not None:
            try:
                (ROOT / name).write_bytes(candidate)
            except OSError as error:
                message = f"Unable to write optimized image: {error}"
            else:
                status = "fixed"
                message = message.replace(
                    "Review the candidate and optimize this image before merging.",
                    "Applied candidate. Review the image in its rendered context before committing.",
                )
        results.append((name, status, message))
        print(f"{status}: {name!r}: {message!r}")
        if status == "error" and os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::error file={escape_annotation(name)}::{escape_annotation(message)}")
        if candidate is not None and args.output_dir:
            output = args.output_dir / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(candidate)
    failures = sum(status == "error" for _, status, _ in results)
    skipped = sum(status == "skipped" for _, status, _ in results)
    fixed = sum(status == "fixed" for _, status, _ in results)
    status_line = f"Checked {len(paths)} images: {failures} failures, {skipped} skipped, {fixed} fixed."
    print(status_line)
    if fixed:
        print("Review all modified images visually before committing; JPEG/WebP compression is lossy.")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with Path(summary).open("a") as stream:
            stream.write(f"## Image optimization\n\n{status_line}\n\n")
            stream.write("Fails only above 25% potential savings or on inspection errors. No fixed byte limits.\n\n")
            stream.write("Candidates keep image dimensions. JPEG/WebP trials are lossy and require visual review.\n\n")
            for name, status, message in results:
                stream.write(f"- **{status}** <code>{html.escape(name)}</code>: {html.escape(message)}\n")
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
