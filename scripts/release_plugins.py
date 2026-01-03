from __future__ import annotations

import sys
from pathlib import Path


def patch_manifest_version(version: str, manifest_path: Path) -> None:
    lines = manifest_path.read_text(encoding="utf-8").splitlines(True)

    replaced_top = False
    in_meta = False
    replaced_meta = False

    out: list[str] = []
    for line in lines:
        stripped = line.strip()

        if not replaced_top and stripped.startswith("version:"):
            out.append(f"version: {version}\n")
            replaced_top = True
            continue

        if stripped == "meta:":
            in_meta = True
            out.append(line)
            continue

        if in_meta and not replaced_meta and stripped.startswith("version:"):
            indent = line[: len(line) - len(line.lstrip(" "))]
            out.append(f"{indent}version: {version}\n")
            replaced_meta = True
            continue

        if in_meta and line and not line.startswith(" "):
            in_meta = False

        out.append(line)

    if not replaced_top:
        raise ValueError(f"manifest has no top-level version: {manifest_path}")

    manifest_path.write_text("".join(out), encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: release_plugins.py <version> <manifest_path>", file=sys.stderr)
        return 2

    version = sys.argv[1]
    manifest_path = Path(sys.argv[2])
    patch_manifest_version(version, manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

