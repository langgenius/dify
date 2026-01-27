from __future__ import annotations

import posixpath
from typing import TYPE_CHECKING

from core.virtual_environment.__base.exec import CommandExecutionError
from core.virtual_environment.__base.helpers import execute, try_execute

from .strategy import ZipStrategy

if TYPE_CHECKING:
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class CliZipStrategy(ZipStrategy):
    """Strategy using native zip/unzip CLI commands."""

    def is_available(self, vm: VirtualEnvironment) -> bool:
        result = try_execute(vm, ["which", "zip"], timeout=10)
        has_zip = bool(result.stdout and result.stdout.strip())
        result = try_execute(vm, ["which", "unzip"], timeout=10)
        has_unzip = bool(result.stdout and result.stdout.strip())
        return has_zip and has_unzip

    def zip(
        self,
        vm: VirtualEnvironment,
        *,
        src: str,
        out_path: str,
        cwd: str | None,
        timeout: float,
    ) -> None:
        if src in (".", ""):
            result = try_execute(vm, ["zip", "-qr", out_path, "."], timeout=timeout, cwd=cwd)
            if not result.is_error:
                return
            # zip exits with 12 when there is nothing to do; create empty zip
            if result.exit_code == 12:
                self._write_empty_zip(vm, out_path)
                return
            raise CommandExecutionError("Failed to create zip archive", result)

        zip_cwd = posixpath.dirname(src) or "."
        target = posixpath.basename(src)
        result = try_execute(vm, ["zip", "-qr", out_path, target], timeout=timeout, cwd=zip_cwd)
        if not result.is_error:
            return
        if result.exit_code == 12:
            self._write_empty_zip(vm, out_path)
            return
        raise CommandExecutionError("Failed to create zip archive", result)

    def unzip(
        self,
        vm: VirtualEnvironment,
        *,
        archive_path: str,
        dest_dir: str,
        timeout: float,
    ) -> None:
        execute(
            vm,
            ["unzip", "-q", archive_path, "-d", dest_dir],
            timeout=timeout,
            error_message="Failed to unzip archive",
        )

    def _write_empty_zip(self, vm: VirtualEnvironment, out_path: str) -> None:
        """Write an empty but valid zip file."""
        script = (
            'printf "'
            "\\x50\\x4b\\x05\\x06"
            "\\x00\\x00\\x00\\x00"
            "\\x00\\x00\\x00\\x00"
            "\\x00\\x00\\x00\\x00"
            "\\x00\\x00\\x00\\x00"
            "\\x00\\x00\\x00\\x00"
            '" > "$1"'
        )
        execute(vm, ["sh", "-c", script, "sh", out_path], timeout=30, error_message="Failed to write empty zip")
