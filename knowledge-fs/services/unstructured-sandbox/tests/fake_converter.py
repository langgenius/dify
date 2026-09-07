#!/usr/bin/env python3
"""Tiny external executable fixture for the converter boundary (not shipped)."""

import os
import signal
import sys
from pathlib import Path

args = sys.argv[1:]
if args in (["--version"], ["--list-input-formats"], ["--list-output-formats"]):
    print("pandoc 3.9" if args == ["--version"] else "html\ndocx\nrtf\nepub\nodt")
    raise SystemExit(0)
mode = os.environ.get("KFS_FAKE_CONVERTER_MODE")
if mode == "signal":
    os.kill(os.getpid(), signal.SIGKILL)
if mode == "error":
    sys.stderr.write("converter failed")
    raise SystemExit(42)
if mode == "large":
    sys.stdout.write("x" * 10000)
    raise SystemExit(0)
if mode == "wait":
    import time

    time.sleep(30)
if "--outdir" in args:
    source = Path(args[-1])
    target_format = args[args.index("--convert-to") + 1].split(":", 1)[0]
    output = Path(args[args.index("--outdir") + 1]) / f"{source.stem}.{target_format}"
    if mode == "missing":
        raise SystemExit(0)
    if mode == "symlink":
        output.symlink_to(source)
        raise SystemExit(0)
    output.write_bytes(source.read_bytes())
    if mode == "collision":
        (source.parent / f"{source.stem}.{target_format}").write_bytes(
            b"concurrent output"
        )
    print("Converted fixture")
else:
    source = Path(next(arg for arg in args if not arg.startswith("-")))
    output = next(
        (arg.split("=", 1)[1] for arg in args if arg.startswith("--output=")), None
    )
    if output:
        Path(output).write_bytes(source.read_bytes())
    else:
        sys.stdout.buffer.write(source.read_bytes())
