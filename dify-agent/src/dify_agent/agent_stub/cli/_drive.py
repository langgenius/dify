"""CLI helpers for sandbox-visible Agent Stub drive commands.

Drive commands stay in the sandbox-facing CLI because they orchestrate existing
control-plane and signed data-plane helpers. The Agent Stub server authenticates
and injects trusted drive scope; this module only formats manifest output,
downloads signed URLs into a local drive base (including safe auto-extraction of
downloaded skill archives), and uploads local files before committing their
ToolFile ids back into the drive.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import ClassVar, Literal
from zipfile import ZIP_DEFLATED, ZipFile

from pydantic import BaseModel, ConfigDict

from dify_agent.agent_stub._drive_materialization import (
    DriveDownloadPayload,
    DriveMaterializationTransferError,
    DriveMaterializationValidationError,
    SKILL_ARCHIVE_FILENAME,
    materialize_drive_downloads,
    resolve_drive_destination,
)
from dify_agent.agent_stub.cli._env import read_agent_stub_environment
from dify_agent.agent_stub.cli._files import upload_tool_file_resource_from_environment
from dify_agent.agent_stub.client._agent_stub import (
    download_file_bytes_from_signed_url_sync,
    request_agent_stub_drive_commit_sync,
    request_agent_stub_drive_manifest_sync,
)
from dify_agent.agent_stub.client._errors import AgentStubTransferError, AgentStubValidationError
from dify_agent.agent_stub.protocol.agent_stub import (
    AgentStubDriveCommitItem,
    AgentStubDriveCommitRequest,
    AgentStubDriveCommitResponse,
    AgentStubDriveFileRef,
    AgentStubDriveItem,
    AgentStubDriveManifestResponse,
    DEFAULT_AGENT_STUB_DRIVE_BASE,
)

_SKILL_MD_FILENAME = "SKILL.md"
_SKIP_DIR_NAMES = frozenset(
    {".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "node_modules"}
)
_SKIP_FILE_NAMES = frozenset({".DS_Store", SKILL_ARCHIVE_FILENAME})
DrivePushKind = Literal["file", "skill", "dir"]


@dataclass(frozen=True, slots=True)
class _DriveUploadItem:
    """Prepared local upload paired with its destination drive key."""

    local_path: Path
    drive_key: str


class DrivePullResult(BaseModel):
    """Structured JSON result for ``dify-agent drive pull --json``."""

    class Item(BaseModel):
        key: str
        local_path: str

        model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    items: list[Item]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def list_drive_manifest_from_environment(prefix: str) -> AgentStubDriveManifestResponse:
    """List drive items through the Agent Stub using the current environment.

    Args:
        prefix: Optional drive-key prefix forwarded to the manifest request.

    Returns:
        The validated manifest response model.

    Side effects:
        Calls the Agent Stub drive manifest control-plane endpoint with
        ``include_download_url=False`` so list output does not allocate signed
        download URLs.
    """

    environment = read_agent_stub_environment()
    response = request_agent_stub_drive_manifest_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        prefix=prefix,
        include_download_url=False,
    )
    return response


def pull_drive_from_environment(
    targets: list[str] | None = None,
    local_base: str | None = None,
) -> DrivePullResult:
    """Pull drive files into one local drive base via signed download URLs.

    Args:
        targets: Optional drive-key targets or prefixes. An empty list preserves
            the historical whole-drive pull by using ``[""]``.
        local_base: Local base directory that receives downloaded drive files.
            When omitted, the historical Agent Stub drive base is used.

    Returns:
        A structured JSON-ready result with downloaded drive keys and their
        written local paths.

    Observable behavior:
        Requests a manifest with ``include_download_url=True``, requires every
        returned item to include ``download_url``, downloads bytes directly from
        those signed URLs, blocks path traversal by resolving each destination
        under the resolved drive base, writes through a temporary sibling file
        before replacing the final path, validates byte length when the manifest
        includes ``size``, and automatically extracts
        ``.DIFY-SKILL-FULL.zip`` archives into their containing skill
        directory with the same path-safety checks. Archive extraction is staged
        under a temporary directory and only moved into place after the full
        archive validates successfully.

        Extracted files are materialized on disk but are not added to the
        returned item list.

    Raises:
        AgentStubValidationError: if a manifest item omits ``download_url``, a
            destination would escape the drive base, or a downloaded skill
            archive contains unsafe entries such as absolute paths, traversal
            entries, or symlink entries.
        AgentStubTransferError: if a downloaded payload does not match declared
            size metadata or a downloaded skill archive is corrupt / not a valid
            zip file.
    """

    environment = read_agent_stub_environment()
    manifest_targets = targets or [""]

    def _fetch_manifest(target: str) -> AgentStubDriveManifestResponse:
        return request_agent_stub_drive_manifest_sync(
            url=environment.url,
            auth_jwe=environment.auth_jwe,
            prefix=target,
            include_download_url=True,
        )

    with ThreadPoolExecutor(max_workers=min(len(manifest_targets), 4)) as executor:
        responses = list(executor.map(_fetch_manifest, manifest_targets))
    downloads: list[DriveDownloadPayload] = []
    resolved_base_path = Path(local_base or DEFAULT_AGENT_STUB_DRIVE_BASE).expanduser().resolve()
    deduplicated_items = {item.key: item for response in responses for item in response.items}
    for item in [deduplicated_items[key] for key in sorted(deduplicated_items)]:
        download_url = item.download_url
        if not isinstance(download_url, str) or not download_url:
            raise AgentStubValidationError(f"drive manifest item is missing download_url: {item.key}")
        try:
            _ = resolve_drive_destination(resolved_base_path, item.key)
        except DriveMaterializationValidationError as exc:
            raise AgentStubValidationError(str(exc)) from exc
        payload = download_file_bytes_from_signed_url_sync(download_url=download_url)
        downloads.append(DriveDownloadPayload(key=item.key, payload=payload, size=item.size))

    try:
        written_paths = materialize_drive_downloads(
            base_path=resolved_base_path,
            downloads=downloads,
        )
    except DriveMaterializationValidationError as exc:
        raise AgentStubValidationError(str(exc)) from exc
    except DriveMaterializationTransferError as exc:
        raise AgentStubTransferError(str(exc)) from exc

    return DrivePullResult(
        items=[
            DrivePullResult.Item(key=download.key, local_path=str(path))
            for download, path in zip(downloads, written_paths, strict=True)
        ]
    )


def push_drive_from_environment(
    local_path: str,
    drive_path: str,
    *,
    kind: DrivePushKind | None,
) -> AgentStubDriveCommitResponse:
    """Upload local files through the Agent Stub and commit them into the drive.

    Args:
        local_path: Source file or directory in the sandbox filesystem.
        drive_path: Destination drive key or drive-key prefix.
        kind: Optional public upload mode. Files infer file mode when omitted,
            while directories require explicit ``skill`` or ``dir`` selection.

    Returns:
        The validated drive commit response returned by the Agent Stub.

    Mode split:
        * If ``local_path`` is a file, upload that file and commit exactly one
          ``tool_file`` binding to ``drive_path``.
        * If ``local_path`` is a directory and ``kind`` is ``"skill"``,
          require ``SKILL.md`` and standardize the upload into
          ``<drive_path>/SKILL.md`` plus ``<drive_path>/.DIFY-SKILL-FULL.zip``.
        * If ``local_path`` is a directory and ``kind`` is ``"dir"``, upload
          each regular file under ``drive_path/<relative_path>`` without skill
          standardization.

    Observable safety behavior:
        Rejects missing local paths, rejects directory pushes without an
        explicit mode, rejects raw directory pushes with no regular files, and
        rejects symlinked or escaping paths, including symlinked top-level
        ``local_path`` roots, while preparing directory uploads or skill
        archives.
    """

    source_path = Path(local_path).expanduser()
    if kind not in {None, "file", "skill", "dir"}:
        raise AgentStubValidationError(f"invalid drive push kind: {kind}")
    if source_path.is_symlink():
        raise AgentStubValidationError(f"drive push does not support symlinked local paths: {source_path}")
    source_path = source_path.resolve()
    if source_path.is_file():
        if kind == "skill":
            raise AgentStubValidationError("--kind skill requires a directory containing SKILL.md")
        if kind == "dir":
            raise AgentStubValidationError("--kind dir requires a directory")
        return _commit_uploaded_items([_prepare_uploaded_file(source_path, drive_path)])
    if not source_path.is_dir():
        raise AgentStubValidationError(f"local path not found: {source_path}")
    if kind is None:
        raise AgentStubValidationError("directory drive push requires --kind skill or --kind dir")
    if kind == "file":
        raise AgentStubValidationError("--kind file requires a file")
    if kind == "dir":
        upload_items = [
            _prepare_uploaded_file(path, _join_drive_key(drive_path, relative_path))
            for path, relative_path in _iter_regular_files(source_path)
        ]
        if not upload_items:
            raise AgentStubValidationError(f"directory has no regular files: {source_path}")
        return _commit_uploaded_items(upload_items)
    return _push_skill_directory(source_path, drive_path)


def _push_skill_directory(source_path: Path, drive_path: str) -> AgentStubDriveCommitResponse:
    skill_md_path = source_path / _SKILL_MD_FILENAME
    if not skill_md_path.is_file():
        raise AgentStubValidationError("--kind skill requires a directory containing SKILL.md")
    with TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / SKILL_ARCHIVE_FILENAME
        _build_skill_archive(source_path, archive_path)
        return _commit_uploaded_items(
            [
                _prepare_uploaded_file(skill_md_path.resolve(), _join_drive_key(drive_path, _SKILL_MD_FILENAME)),
                _prepare_uploaded_file(archive_path, _join_drive_key(drive_path, SKILL_ARCHIVE_FILENAME)),
            ]
        )


def _prepare_uploaded_file(local_path: Path, drive_key: str) -> _DriveUploadItem:
    return _DriveUploadItem(local_path=local_path, drive_key=drive_key)


def _commit_uploaded_items(items: list[_DriveUploadItem]) -> AgentStubDriveCommitResponse:
    environment = read_agent_stub_environment()
    commit_items: list[AgentStubDriveCommitItem] = []
    for item in items:
        uploaded_file = upload_tool_file_resource_from_environment(path=str(item.local_path))
        commit_items.append(
            AgentStubDriveCommitItem(
                key=item.drive_key,
                file_ref=AgentStubDriveFileRef(kind="tool_file", id=uploaded_file.tool_file_id),
            )
        )
    return request_agent_stub_drive_commit_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        request=AgentStubDriveCommitRequest(items=commit_items),
    )


def format_drive_manifest(response: AgentStubDriveManifestResponse) -> str:
    return "\n".join(_format_manifest_item(item) for item in response.items)


def _format_manifest_item(item: AgentStubDriveItem) -> str:
    size = str(item.size) if item.size is not None else "-"
    mime_type = item.mime_type or "-"
    item_hash = item.hash or "-"
    return f"{size}\t{mime_type}\t{item_hash}\t{item.key}"


def _iter_regular_files(root_path: Path) -> list[tuple[Path, str]]:
    """Return all regular files under one directory, rejecting unsafe symlinks."""

    return _iter_regular_files_with_skip_filter(root_path, skip_filtered=False)


def _iter_skill_archive_files(root_path: Path) -> list[tuple[Path, str]]:
    """Return regular files for skill packaging, excluding transient content."""

    return _iter_regular_files_with_skip_filter(root_path, skip_filtered=True)


def _iter_regular_files_with_skip_filter(root_path: Path, *, skip_filtered: bool) -> list[tuple[Path, str]]:
    root_resolved = root_path.resolve()
    collected: list[tuple[Path, str]] = []
    for candidate in sorted(root_path.rglob("*")):
        if skip_filtered and _should_skip_path(candidate, root_path):
            continue
        if candidate.is_symlink():
            raise AgentStubValidationError(f"drive push does not support symlinked files: {candidate}")
        if not candidate.is_file():
            continue
        resolved_candidate = candidate.resolve()
        try:
            relative_path = resolved_candidate.relative_to(root_resolved)
        except ValueError as exc:
            raise AgentStubValidationError(
                f"drive push file resolves outside the source directory: {candidate}"
            ) from exc
        collected.append((resolved_candidate, relative_path.as_posix()))
    return collected


def _should_skip_path(candidate: Path, root_path: Path) -> bool:
    relative_path = candidate.relative_to(root_path)
    if any(part in _SKIP_DIR_NAMES for part in relative_path.parts):
        return True
    return candidate.name in _SKIP_FILE_NAMES


def _build_skill_archive(source_path: Path, archive_path: Path) -> None:
    with ZipFile(archive_path, mode="w", compression=ZIP_DEFLATED) as archive:
        for file_path, relative_path in _iter_skill_archive_files(source_path):
            archive.write(file_path, arcname=relative_path)


def _join_drive_key(base_key: str, child_key: str) -> str:
    stripped_base = base_key.rstrip("/")
    stripped_child = child_key.lstrip("/")
    return f"{stripped_base}/{stripped_child}" if stripped_base else stripped_child


__all__ = [
    "DrivePullResult",
    "DrivePushKind",
    "format_drive_manifest",
    "list_drive_manifest_from_environment",
    "pull_drive_from_environment",
    "push_drive_from_environment",
]
