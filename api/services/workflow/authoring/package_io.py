"""Read an uploaded package as archive entries, merge its manifest with a filled `app.yaml`, and write it again."""

from __future__ import annotations

import hashlib
import lzma
import zipfile
import zlib
from collections.abc import Iterator, Sequence
from typing import IO, Any, Final, override

import yaml
from pydantic import ValidationError

from configs import dify_config
from libs.archive_writer import (
    ArchiveCompression,
    ArchiveEntry,
    ArchiveError,
    ArchiveLimitKind,
    ArchiveLimits,
    ArchiveOptions,
    ChunkSource,
    StrictPathPolicy,
    write_archive,
)
from services.agent.errors import RosterAgentPackageTooLargeError
from services.agent.roster_package_entities import RosterAgentPackageApp
from services.agent.roster_package_reader import PackageYamlAliasError, PackageYamlLoader
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
_YAML_ERRORS: Final = (UnicodeDecodeError, yaml.YAMLError, ValueError, RecursionError)
_APP_USES_ALIASES: Final = f"{APP_PATH} uses YAML aliases; write each value out"
_APP_NOT_YAML: Final = f"{APP_PATH} is not valid YAML: {{problem}}"
_PROBLEM_AT: Final = "{problem} (line {line}, column {column})"
_APP_NOT_MAPPING: Final = f"{APP_PATH} must be a YAML mapping"


class PackageUnreadableError(ValueError):
    pass


def read_package_entries(source: IO[bytes]) -> list[ArchiveEntry]:
    """Every file of a zip, sub-folder paths kept and directory entries skipped.

    Members are read from `source` when an entry is opened, so `source` must stay open until the entries are
    written. Raises `PackageUnreadableError` for a bad zip or an unsafe path, and when a member cannot be read;
    `RosterAgentPackageTooLargeError` when the members outnumber the package reader's entry limit or their
    declared sizes add up past its size limit.
    """
    try:
        archive = zipfile.ZipFile(source)
        members = archive.infolist()
        # Counted as the package reader counts them, directory entries included.
        max_entries = dify_config.AGENT_PACKAGE_MAX_ENTRIES
        if len(members) > max_entries:
            raise RosterAgentPackageTooLargeError(f"App package {ArchiveLimitKind.ENTRIES.exceeded(max_entries)}")
        infos = [info for info in members if not info.is_dir()]
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
    data = load_member_yaml(manifest)
    root = _root_app(data)
    if root is None:
        return None
    resource = _app(app)
    if _describes(root, resource):
        return manifest
    root.update(size=resource.size, sha256=resource.sha256)
    try:
        AppPackageManifest.model_validate(data)
    except ValidationError:
        return None
    return yaml.safe_dump(data).encode()


def manifest_is_stale(manifest: bytes, app: bytes) -> bool:
    """True when the manifest's `apps[0]` is `app.yaml` with a size or sha256 other than `app`'s.

    A manifest that cannot be read, or whose `apps[0]` is not `app.yaml`, is not stale.
    """
    root = _root_app(load_member_yaml(manifest))
    if root is None:
        return False
    return not _describes(root, _app(app))


def load_member_yaml(content: bytes) -> object:
    """A member's YAML data, read as the package reader reads it; None when it cannot be parsed."""
    try:
        return _load_yaml(content)
    except _YAML_ERRORS:
        return None


def read_app_document(content: bytes) -> dict[str, Any]:
    """The `app.yaml` mapping, read as the package import reads it, which refuses aliases, duplicate keys and keys
    that are not text. Raises `PackageUnreadableError` naming the cause.
    """
    try:
        document = _load_yaml(content)
    except PackageYamlAliasError as error:
        raise PackageUnreadableError(_APP_USES_ALIASES) from error
    except _YAML_ERRORS as error:
        raise PackageUnreadableError(_APP_NOT_YAML.format(problem=_problem(error))) from error
    if not isinstance(document, dict):
        raise PackageUnreadableError(_APP_NOT_MAPPING)
    return document


def _problem(error: Exception) -> str:
    """One line: what PyYAML found, and where when it says."""
    if not isinstance(error, yaml.MarkedYAMLError):
        return str(error).partition("\n")[0]
    problem = error.problem or error.context or type(error).__name__
    mark = error.problem_mark
    if mark is None:
        return problem
    return _PROBLEM_AT.format(problem=problem, line=mark.line + 1, column=mark.column + 1)


class _NoAliasDumper(yaml.Dumper):
    @override
    def ignore_aliases(self, data: object) -> bool:
        return True


def dump_app_document(document: dict[str, Any]) -> bytes:
    """The `app.yaml` bytes for `document`, with every value written out (the reader refuses aliases)."""
    return yaml.dump(document, Dumper=_NoAliasDumper, allow_unicode=True).encode()


def _load_yaml(content: bytes) -> object:
    return yaml.load(content, Loader=PackageYamlLoader)  # noqa: S506


def _describes(root: dict[str, Any], resource: RosterAgentPackageApp) -> bool:
    return (root.get("size"), root.get("sha256")) == (resource.size, resource.sha256)


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
