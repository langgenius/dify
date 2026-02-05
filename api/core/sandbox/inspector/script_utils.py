"""Shared helpers for sandbox inspector shell commands."""

from __future__ import annotations

import json
from typing import TypedDict, cast

_PYTHON_EXEC_CMD = 'if command -v python3 >/dev/null 2>&1; then py=python3; else py=python; fi; "$py" -c "$0" "$@"'
_LIST_SCRIPT = r"""
import json
import os
import sys

path = sys.argv[1]
recursive = sys.argv[2] == "1"

def norm(rel: str) -> str:
    rel = rel.replace("\\\\", "/")
    rel = rel.lstrip("./")
    return rel or "."

def stat_entry(full_path: str, rel_path: str) -> dict[str, object]:
    st = os.stat(full_path)
    is_dir = os.path.isdir(full_path)
    return {
        "path": norm(rel_path),
        "is_dir": is_dir,
        "size": None if is_dir else int(st.st_size),
        "mtime": int(st.st_mtime),
    }

entries = []
if recursive:
    for root, dirs, files in os.walk(path):
        for d in dirs:
            fp = os.path.join(root, d)
            rp = os.path.relpath(fp, ".")
            entries.append(stat_entry(fp, rp))
        for f in files:
            fp = os.path.join(root, f)
            rp = os.path.relpath(fp, ".")
            entries.append(stat_entry(fp, rp))
else:
    if os.path.isfile(path):
        rel_path = os.path.relpath(path, ".")
        entries.append(stat_entry(path, rel_path))
    else:
        for item in os.scandir(path):
            rel_path = os.path.relpath(item.path, ".")
            entries.append(stat_entry(item.path, rel_path))

print(json.dumps(entries))
"""


class ListedEntry(TypedDict):
    path: str
    is_dir: bool
    size: int | None
    mtime: int


def build_list_command(path: str, recursive: bool) -> list[str]:
    return [
        "sh",
        "-c",
        _PYTHON_EXEC_CMD,
        _LIST_SCRIPT,
        path,
        "1" if recursive else "0",
    ]


def parse_list_output(stdout: bytes) -> list[ListedEntry]:
    try:
        raw = json.loads(stdout.decode("utf-8"))
    except Exception as exc:
        raise RuntimeError("Malformed sandbox file list output") from exc
    if not isinstance(raw, list):
        raise RuntimeError("Malformed sandbox file list output")
    return cast(list[ListedEntry], raw)


def build_detect_kind_command(path: str) -> list[str]:
    return [
        "sh",
        "-c",
        'if [ -d "$1" ]; then echo dir; elif [ -f "$1" ]; then echo file; else exit 2; fi',
        "sh",
        path,
    ]


def parse_kind_output(stdout: bytes, *, not_found_message: str) -> str:
    kind = stdout.decode("utf-8", errors="replace").strip()
    if kind not in ("dir", "file"):
        raise ValueError(not_found_message)
    return kind
