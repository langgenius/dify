from __future__ import annotations

from typing import TYPE_CHECKING

from core.virtual_environment.__base.helpers import execute, try_execute

from .strategy import ZipStrategy

if TYPE_CHECKING:
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


ZIP_SCRIPT = r"""
import os
import sys
import zipfile

src = sys.argv[1]
out_path = sys.argv[2]

def is_cwd(p: str) -> bool:
    return p in (".", "")

src = src.rstrip("/")

if is_cwd(src):
    base = "."
    root = "."
    prefix = ""
else:
    base = os.path.dirname(src) or "."
    prefix = os.path.basename(src)
    root = os.path.join(base, prefix)

def add_empty_dir(zf: zipfile.ZipFile, arc_dir: str) -> None:
    name = arc_dir.rstrip("/") + "/"
    if name != "/":
        zf.writestr(name, b"")

with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    if os.path.isfile(root):
        zf.write(root, arcname=os.path.basename(root))
    else:
        for dirpath, dirnames, filenames in os.walk(root):
            rel_dir = os.path.relpath(dirpath, base)
            rel_dir = "" if rel_dir == "." else rel_dir
            if not dirnames and not filenames:
                add_empty_dir(zf, rel_dir)
            for fn in filenames:
                fp = os.path.join(dirpath, fn)
                arcname = os.path.join(rel_dir, fn) if rel_dir else fn
                zf.write(fp, arcname=arcname)
"""

UNZIP_SCRIPT = r"""
import sys
import zipfile

archive_path = sys.argv[1]
dest_dir = sys.argv[2]

with zipfile.ZipFile(archive_path, "r") as zf:
    zf.extractall(dest_dir)
"""


class PythonZipStrategy(ZipStrategy):
    """Strategy using Python's zipfile module."""

    def __init__(self) -> None:
        self._python_cmd: str | None = None

    def is_available(self, vm: VirtualEnvironment) -> bool:
        for cmd in ("python3", "python"):
            result = try_execute(vm, ["which", cmd], timeout=10)
            if result.stdout and result.stdout.strip():
                self._python_cmd = cmd
                return True
        return False

    def zip(
        self,
        vm: VirtualEnvironment,
        *,
        src: str,
        out_path: str,
        cwd: str | None,
        timeout: float,
    ) -> None:
        if self._python_cmd is None:
            raise RuntimeError("Python not available")

        execute(
            vm,
            [self._python_cmd, "-c", ZIP_SCRIPT, src, out_path],
            timeout=timeout,
            cwd=cwd,
            error_message="Failed to create zip archive",
        )

    def unzip(
        self,
        vm: VirtualEnvironment,
        *,
        archive_path: str,
        dest_dir: str,
        timeout: float,
    ) -> None:
        if self._python_cmd is None:
            raise RuntimeError("Python not available")

        execute(
            vm,
            [self._python_cmd, "-c", UNZIP_SCRIPT, archive_path, dest_dir],
            timeout=timeout,
            error_message="Failed to unzip archive",
        )
