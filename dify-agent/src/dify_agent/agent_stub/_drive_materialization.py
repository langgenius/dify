"""Shared drive download materialization helpers.

This module centralizes the safety-critical filesystem logic used by both the
sandbox-visible CLI and the runtime drive layer. It owns path resolution under
one local drive base, overwrite-via-temp-file semantics, payload size checks,
and safe extraction of downloaded skill archives so those invariants cannot
drift between the two call sites.
"""

from __future__ import annotations

import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import Final
from uuid import uuid4
from zipfile import BadZipFile, ZipFile, ZipInfo


SKILL_ARCHIVE_FILENAME: Final[str] = ".DIFY-SKILL-FULL.zip"


@dataclass(frozen=True, slots=True)
class DriveDownloadPayload:
    """One downloaded drive payload ready to materialize under a local base."""

    key: str
    payload: bytes
    size: int | None = None


class DriveMaterializationValidationError(ValueError):
    """Raised when one drive key or archive entry is structurally unsafe."""


class DriveMaterializationTransferError(RuntimeError):
    """Raised when one downloaded payload cannot be safely materialized."""


def materialize_drive_downloads(
    *,
    base_path: Path,
    downloads: list[DriveDownloadPayload],
) -> list[Path]:
    """Write downloaded drive payloads under one local base and extract skills.

    The helper preserves caller-provided order in the returned list of paths.
    Skill archives are extracted and deleted only after every payload has been
    written successfully so partial extraction cannot outlive a later failure in
    the same batch. The returned path for an archive is the path where it was
    downloaded before successful extraction.
    """

    resolved_base_path = base_path.expanduser().resolve()
    try:
        _ = resolved_base_path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise DriveMaterializationTransferError(f"failed to prepare drive base {resolved_base_path}") from exc

    written_paths: list[Path] = []
    archive_paths: list[Path] = []
    for download in downloads:
        if download.size is not None and len(download.payload) != download.size:
            raise DriveMaterializationTransferError(f"downloaded drive file size mismatch for {download.key}")
        destination = resolve_drive_destination(resolved_base_path, download.key)
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp_path = destination.with_name(f"{destination.name}.tmp-{uuid4().hex}")
            _ = temp_path.write_bytes(download.payload)
            _ = temp_path.replace(destination)
        except OSError as exc:
            raise DriveMaterializationTransferError(f"failed to materialize drive file {download.key}") from exc
        written_paths.append(destination)
        if destination.name == SKILL_ARCHIVE_FILENAME:
            archive_paths.append(destination)

    for archive_path in sorted(archive_paths):
        extract_skill_archive(archive_path)
        _delete_extracted_archive(archive_path)
    return written_paths


def resolve_drive_destination(base_path: Path, drive_key: str) -> Path:
    """Resolve one drive key under a local base and reject path traversal."""

    destination = (base_path / Path(drive_key)).resolve()
    try:
        destination.relative_to(base_path)
    except ValueError as exc:
        raise DriveMaterializationValidationError(f"drive key resolves outside the drive base: {drive_key}") from exc
    return destination


def extract_archive_to_directory(archive_path: Path, *, target_dir: Path) -> None:
    """Safely extract one downloaded archive into one resolved target directory."""

    resolved_target_dir = target_dir.resolve()
    try:
        with TemporaryDirectory(dir=resolved_target_dir, prefix=".dify-skill-extract-") as staging_dir_name:
            staging_dir = Path(staging_dir_name).resolve()
            with ZipFile(archive_path) as archive:
                for zip_info in archive.infolist():
                    destination = _resolve_zip_entry_destination(staging_dir, zip_info.filename)
                    if _is_zip_symlink(zip_info):
                        raise DriveMaterializationValidationError(
                            f"skill archive contains unsupported symlink entry: {zip_info.filename}"
                        )
                    if zip_info.is_dir():
                        destination.mkdir(parents=True, exist_ok=True)
                        continue
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(zip_info) as source_file:
                        temp_path = destination.with_name(f"{destination.name}.tmp-{uuid4().hex}")
                        _ = temp_path.write_bytes(source_file.read())
                        _ = temp_path.replace(destination)
            for staged_path in sorted(staging_dir.rglob("*")):
                if staged_path.is_dir():
                    continue
                relative_path = staged_path.relative_to(staging_dir)
                destination = (resolved_target_dir / relative_path).resolve()
                destination.parent.mkdir(parents=True, exist_ok=True)
                _ = staged_path.replace(destination)
    except DriveMaterializationValidationError:
        raise
    except (BadZipFile, OSError) as exc:
        raise DriveMaterializationTransferError(f"downloaded skill archive is invalid: {archive_path.name}") from exc


def extract_skill_archive(archive_path: Path) -> None:
    """Safely extract one downloaded skill archive into its containing directory."""

    extract_archive_to_directory(archive_path, target_dir=archive_path.parent.resolve())


def _resolve_zip_entry_destination(target_dir: Path, entry_name: str) -> Path:
    normalized_name = entry_name.replace("\\", "/")
    pure_path = PurePosixPath(normalized_name)
    if not normalized_name or normalized_name.startswith("/") or pure_path.is_absolute():
        raise DriveMaterializationValidationError(f"skill archive contains unsafe absolute path: {entry_name}")
    if any(part in {"", ".", ".."} for part in pure_path.parts):
        raise DriveMaterializationValidationError(f"skill archive contains unsafe path traversal entry: {entry_name}")
    destination = (target_dir / Path(*pure_path.parts)).resolve()
    try:
        destination.relative_to(target_dir)
    except ValueError as exc:
        raise DriveMaterializationValidationError(
            f"skill archive entry resolves outside the skill directory: {entry_name}"
        ) from exc
    return destination


def _is_zip_symlink(zip_info: ZipInfo) -> bool:
    file_mode = zip_info.external_attr >> 16
    return stat.S_ISLNK(file_mode)


def _delete_extracted_archive(archive_path: Path) -> None:
    try:
        archive_path.unlink(missing_ok=True)
    except OSError as exc:
        raise DriveMaterializationTransferError(
            f"failed to delete extracted skill archive: {archive_path.name}"
        ) from exc


__all__ = [
    "DriveDownloadPayload",
    "DriveMaterializationTransferError",
    "DriveMaterializationValidationError",
    "SKILL_ARCHIVE_FILENAME",
    "extract_archive_to_directory",
    "extract_skill_archive",
    "materialize_drive_downloads",
    "resolve_drive_destination",
]
