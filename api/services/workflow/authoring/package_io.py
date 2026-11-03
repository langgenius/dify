"""Read an uploaded package as archive entries, merge its manifest with a filled `app.yaml`, and write it again."""

from __future__ import annotations

import hashlib
import lzma
import zipfile
import zlib
from collections.abc import Iterator, Sequence
from typing import IO, Any, Final

import yaml
from pydantic import ValidationError

from configs import dify_config
from libs.archive_writer import (
    ArchiveCompression,
    ArchiveEntry,
    ArchiveError,
    ArchiveLimits,
    ArchiveOptions,
    ChunkSource,
    StrictPathPolicy,
    write_archive,
)
from services.agent.errors import RosterAgentPackageTooLargeError
from services.agent.roster_package_entities import RosterAgentPackageApp
from services.agent.roster_package_reader import PackageYamlLoader
from services.app_package_service import AppPackageManifest

APP_PATH: Final = "app.yaml"
MANIFEST_PATH: Final = "manifest.yaml"
_APP_PACKAGE_FORMAT: Final = "dify.app"
_FIRST_FORMAT_VERSION: Final = 1
_CHUNK_SIZE: Final = 1024 * 1024
_ZIP_ERRORS: Final = (
    OSError,
    zipfile.BadZipFile,
    EOFError,
    RuntimeError,
    NotImplementedError,
    zlib.error,
    lzma.LZMAError,
)
YAML_ERRORS: Final = (UnicodeDecodeError, yaml.YAMLError, ValueError, RecursionError)


class PackageUnreadableError(ValueError):
    pass


def read_package_entries(source: IO[bytes]) -> list[ArchiveEntry]:
    """Every file of a zip, sub-folder paths kept and directory entries skipped.

    Members are read from `source` when an entry is opened, so `source` must stay open until the entries are
    written. Raises `PackageUnreadableError` for a bad zip or an unsafe path, and when a member cannot be read;
    `RosterAgentPackageTooLargeError` when the members' declared sizes add up past the package reader's limit.
    """
    try:
        archive = zipfile.ZipFile(source)
        infos = [info for info in archive.infolist() if not info.is_dir()]
        # A member never inflates past its declared size, so the declared total bounds what fill reads.
        if sum(info.file_size for info in infos) > dify_config.AGENT_PACKAGE_MAX_BYTES:
            raise RosterAgentPackageTooLargeError("App package uncompressed size exceeds the limit")
        entries = [ArchiveEntry(info.filename, _member_chunks(archive, info)) for info in infos]
        return list(StrictPathPolicy().admit(entries))
    except ArchiveError as exc:
        raise PackageUnreadableError(str(exc)) from exc
    except _ZIP_ERRORS as exc:
        raise PackageUnreadableError("The package is not a valid zip") from exc


def _member_chunks(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> ChunkSource:
    def read_chunks() -> Iterator[bytes]:
        try:
            with archive.open(info) as member:
                while chunk := member.read(_CHUNK_SIZE):
                    yield chunk
        except _ZIP_ERRORS as exc:
            raise PackageUnreadableError(f"{info.filename} cannot be read from the package") from exc

    return read_chunks


def read_member(entry: ArchiveEntry, *, max_bytes: int) -> bytes:
    """The member's bytes; raises `RosterAgentPackageTooLargeError` past `max_bytes`, as the package reader does."""
    chunks: list[bytes] = []
    size = 0
    for chunk in entry.open():
        size += len(chunk)
        if size > max_bytes:
            raise RosterAgentPackageTooLargeError(f"App package {entry.path} exceeds the size limit")
        chunks.append(chunk)
    return b"".join(chunks)


def bytes_entry(path: str, payload: bytes) -> ArchiveEntry:
    return ArchiveEntry(path, lambda: [payload])


def new_manifest(app: bytes) -> bytes:
    """The manifest the export writes for a package that holds only `app`."""
    manifest = AppPackageManifest(format=_APP_PACKAGE_FORMAT, format_version=_FIRST_FORMAT_VERSION, apps=[_app(app)])
    return yaml.safe_dump(manifest.model_dump(mode="json", exclude_defaults=True)).encode()


def merge_manifest(manifest: bytes, app: bytes) -> bytes | None:
    """The manifest for `app`: kept byte for byte when `apps[0]` already describes it, else with only
    `apps[0].size` and `sha256` rewritten; None when it cannot be read or the rewrite is not a valid manifest.
    """
    try:
        data = yaml.load(manifest, Loader=PackageYamlLoader)  # noqa: S506
    except YAML_ERRORS:
        return None
    root = _root_app(data)
    if root is None:
        return None
    resource = _app(app)
    if (root.get("size"), root.get("sha256")) == (resource.size, resource.sha256):
        return manifest
    root.update(size=resource.size, sha256=resource.sha256)
    try:
        AppPackageManifest.model_validate(data)
    except ValidationError:
        return None
    return yaml.safe_dump(data).encode()


def _root_app(data: object) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    apps = data.get("apps")
    if not isinstance(apps, list):
        return None
    if not apps:
        return None
    root = apps[0]
    if not isinstance(root, dict):
        return None
    if root.get("path") != APP_PATH:
        return None
    return root


def _app(app: bytes) -> RosterAgentPackageApp:
    return RosterAgentPackageApp(path=APP_PATH, size=len(app), sha256=hashlib.sha256(app).hexdigest())


def write_package(entries: Sequence[ArchiveEntry], *, limits: ArchiveLimits) -> bytes:
    """The deflated archive; raises the archive writer's errors for an unsafe path or a package over `limits`."""
    result = write_archive(entries, ArchiveOptions(StrictPathPolicy(), limits, ArchiveCompression.DEFLATED))
    with result.file as file:
        return file.read()
