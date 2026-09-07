"""Executable wrapper entrypoint; no caller-selected executables or shell evaluation."""

import json
import os
import sys
from pathlib import Path

from .admission import Rejected
from .conversion import convert


MANIFEST = Path("/opt/kfs-sandbox/converters.json")


def run(
    kind: str, arguments: list[str], directory: Path, manifest: Path, stdout, stderr
) -> int:
    raw = manifest.read_bytes()
    if len(raw) > 4096:
        raise RuntimeError("Invalid converter manifest")
    executable = json.loads(raw)[kind]
    if (
        not isinstance(executable, str)
        or not Path(executable).is_absolute()
        or not os.access(executable, os.X_OK)
    ):
        raise RuntimeError("Invalid converter executable")
    try:
        return convert(kind, arguments, directory, [executable], stdout, stderr)
    except Rejected:
        # LibreOffice's caller retries if stdout is empty, even with a nonzero exit code.
        # A nonempty generic message prevents wasting its retry loop on known rejection.
        if kind == "soffice":
            stdout.write(b"KnowledgeFS converter admission rejected\n")
        stderr.write(b"KnowledgeFS converter admission rejected\n")
        return 65


def main(kind: str) -> None:
    try:
        directory = Path(os.environ["KFS_CONVERSION_DIRECTORY"])
        code = run(
            kind,
            sys.argv[1:],
            directory,
            MANIFEST,
            sys.stdout.buffer,
            sys.stderr.buffer,
        )
    except Exception:
        # Wrong image/invocation is a configuration failure, not a safe fallback to a
        # raw executable. Never leak converter exceptions, arguments, paths, or text.
        sys.stderr.write("KnowledgeFS converter runtime is unavailable\n")
        code = 70
    raise SystemExit(code)
