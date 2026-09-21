"""Check frontend image budgets using only the Python standard library."""

from __future__ import annotations

import argparse
import base64
import binascii
import gzip
import html
import json
import os
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import unquote_to_bytes

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).with_name("budgets.json")
PREFIXES = ("web/public/", "web/app/", "packages/iconify-collections/assets/")
RASTER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico", ".bmp", ".tif", ".tiff"}
RULES = {"raster-bytes", "svg-gzip-bytes", "embedded-raster-bytes"}


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
        if path.startswith(PREFIXES) and Path(path).suffix.lower() in RASTER_EXTENSIONS | {".svg"}
    )


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    if set(config) != {"limits", "exceptions"} or set(config["limits"]) != RULES:
        raise ValueError("Budget config must contain limits for all rules and an exceptions object")
    if any(type(value) is not int or value <= 0 for value in config["limits"].values()):
        raise ValueError("Image budgets must be positive integer byte counts")
    if not isinstance(config["exceptions"], dict):
        raise TypeError("Image budget exceptions must be an object keyed by exact file path")
    for name, exceptions in config["exceptions"].items():
        if not name.startswith(PREFIXES) or not isinstance(exceptions, dict) or not exceptions:
            raise ValueError(f"Invalid image budget exception: {name}")
        if not set(exceptions) <= RULES:
            raise ValueError(f"Unknown image budget rule in exception: {name}")
        if any(not isinstance(reason, str) or not reason.strip() for reason in exceptions.values()):
            raise ValueError(f"Each image budget exception needs a reason: {name}")
    return config


def image_sizes(path: Path) -> dict[str, int]:
    data = path.read_bytes()
    if path.suffix.lower() != ".svg":
        return {"raster-bytes": len(data)}
    root = ET.fromstring(data)
    embedded = 0
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
        embedded += len(raw)
    return {"svg-gzip-bytes": len(gzip.compress(data, mtime=0)), "embedded-raster-bytes": embedded}


def inspect_image(name: str, config: dict, root: Path = ROOT) -> tuple[list[str], list[str]]:
    path = root / name
    if path.is_symlink():
        return ["Image symlinks are not supported; use a regular image file."], []
    try:
        sizes = image_sizes(path)
    except (OSError, ET.ParseError, ValueError, binascii.Error) as error:
        return [f"Unable to inspect image: {error}"], []
    failures, exemptions = [], []
    for rule, size in sizes.items():
        limit = config["limits"][rule]
        if size <= limit:
            continue
        detail = f"{rule}: {size:,} B exceeds {limit:,} B"
        reason = config["exceptions"].get(name, {}).get(rule)
        if reason:
            exemptions.append(f"{detail} — exempt: {reason}")
        else:
            failures.append(f"{detail}. Resize/compress the resource or document a justified exception.")
    return failures, exemptions


def escape_annotation(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A").replace(",", "%2C").replace(":", "%3A")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--base", help="Check images changed between the merge base and HEAD")
    mode.add_argument("--all", action="store_true", help="Audit all tracked frontend images")
    args = parser.parse_args()
    config = load_config(CONFIG)
    paths = image_paths(args.base)
    findings = []
    exempted = []
    for name in paths:
        failures, exemptions = inspect_image(name, config)
        findings.extend((name, message) for message in failures)
        exempted.extend((name, message) for message in exemptions)
    for name, message in findings:
        print(f"{name!r}: {message!r}")
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::error file={escape_annotation(name)}::{escape_annotation(message)}")
    for name, message in exempted:
        print(f"{name!r}: {message!r}")
    status = f"Checked {len(paths)} images: {len(findings)} budget/inspection failures, {len(exempted)} exemptions."
    print(status)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with Path(summary).open("a") as stream:
            stream.write(f"## Image resource budgets\n\n{status}\n\n")
            stream.write(
                "File sizes and local gzip estimates are heuristics, not production transfer measurements.\n\n"
            )
            for name, message in findings + exempted:
                stream.write(f"- <code>{html.escape(name)}</code>: {html.escape(message)}\n")
    return int(bool(findings))


if __name__ == "__main__":
    raise SystemExit(main())
