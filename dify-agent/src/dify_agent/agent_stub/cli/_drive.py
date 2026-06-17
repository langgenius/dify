"""CLI helpers for sandbox-visible Agent Stub drive commands.

Drive commands stay in the sandbox-facing CLI because they orchestrate existing
control-plane and signed data-plane helpers. The Agent Stub server authenticates
and injects trusted drive scope; this module only formats manifest output,
downloads signed URLs into a local drive base, and uploads local files before
committing their ToolFile ids back into the drive.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

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
)

_SKILL_MD_FILENAME = "SKILL.md"
_SKILL_ARCHIVE_FILENAME = ".DIFY-SKILL-FULL.zip"
_SKIP_DIR_NAMES = frozenset({".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "node_modules"})
_SKIP_FILE_NAMES = frozenset({".DS_Store", _SKILL_ARCHIVE_FILENAME})


@dataclass(frozen=True, slots=True)
class _DriveUploadItem:
    """Prepared local upload paired with its destination drive key."""

    local_path: Path
    drive_key: str


def list_drive_from_environment(prefix: str, json_output: bool) -> str | AgentStubDriveManifestResponse:
    """List drive items through the Agent Stub using the current environment.

    Args:
        prefix: Optional drive-key prefix forwarded to the manifest request.
        json_output: When ``True``, return the validated manifest response model.
            When ``False``, return one human-readable tab-separated line per item
            containing size, mime type, hash, and key.

    Returns:
        Either ``AgentStubDriveManifestResponse`` for JSON callers or a formatted
        string for human-facing CLI output.

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
    if json_output:
        return response
    return _format_manifest(response)


def pull_drive_from_environment(prefix: str, drive_base: str = "/mnt/drive") -> list[Path]:
    """Pull drive files into one local drive base via signed download URLs.

    Args:
        prefix: Optional drive-key prefix forwarded to the manifest request.
        drive_base: Local base directory that receives downloaded drive files.

    Returns:
        A list of written local paths under ``drive_base``.

    Observable behavior:
        Requests a manifest with ``include_download_url=True``, requires every
        returned item to include ``download_url``, downloads bytes directly from
        those signed URLs, blocks path traversal by resolving each destination
        under the resolved drive base, writes through a temporary sibling file
        before replacing the final path, and validates byte length when the
        manifest includes ``size``.

    Raises:
        AgentStubValidationError: if a manifest item omits ``download_url`` or a
            destination would escape the drive base.
        AgentStubTransferError: if a downloaded payload does not match declared
            size metadata.
    """

    environment = read_agent_stub_environment()
    response = request_agent_stub_drive_manifest_sync(
        url=environment.url,
        auth_jwe=environment.auth_jwe,
        prefix=prefix,
        include_download_url=True,
    )
    base_path = Path(drive_base).expanduser().resolve()
    base_path.mkdir(parents=True, exist_ok=True)
    written_paths: list[Path] = []
    for item in response.items:
        download_url = item.download_url
        if not isinstance(download_url, str) or not download_url:
            raise AgentStubValidationError(f"drive manifest item is missing download_url: {item.key}")
        destination = _resolve_drive_destination(base_path, item.key)
        payload = download_file_bytes_from_signed_url_sync(download_url=download_url)
        if item.size is not None and len(payload) != item.size:
            raise AgentStubTransferError(f"downloaded drive file size mismatch for {item.key}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_path = destination.with_name(f"{destination.name}.tmp-{uuid4().hex}")
        temp_path.write_bytes(payload)
        temp_path.replace(destination)
        written_paths.append(destination)
    return written_paths


def push_drive_from_environment(local_path: str, drive_path: str, recursive: bool) -> AgentStubDriveCommitResponse:
    """Upload local files through the Agent Stub and commit them into the drive.

    Args:
        local_path: Source file or directory in the sandbox filesystem.
        drive_path: Destination drive key or drive-key prefix.
        recursive: Select directory mode. ``False`` standardizes skill
            directories, while ``True`` uploads raw directory contents.

    Returns:
        The validated drive commit response returned by the Agent Stub.

    Mode split:
        * If ``local_path`` is a file, upload that file and commit exactly one
          ``tool_file`` binding to ``drive_path``.
        * If ``local_path`` is a directory and ``recursive`` is ``False``,
          require ``SKILL.md`` and standardize the upload into
          ``<drive_path>/SKILL.md`` plus ``<drive_path>/.DIFY-SKILL-FULL.zip``.
        * If ``local_path`` is a directory and ``recursive`` is ``True``, upload
          each regular file under ``drive_path/<relative_path>`` without skill
          standardization.

    Observable safety behavior:
        Rejects missing local paths, rejects recursive directory pushes with no
        regular files, and rejects symlinked or escaping paths while preparing
        directory uploads or skill archives.
    """

    source_path = Path(local_path).expanduser().resolve()
    if source_path.is_file():
        return _commit_uploaded_items([_prepare_uploaded_file(source_path, drive_path)])
    if not source_path.is_dir():
        raise AgentStubValidationError(f"local path not found: {source_path}")
    if recursive:
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
        raise AgentStubValidationError(f"non-recursive drive push requires {_SKILL_MD_FILENAME}: {source_path}")
    with TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / _SKILL_ARCHIVE_FILENAME
        _build_skill_archive(source_path, archive_path)
        return _commit_uploaded_items(
            [
                _prepare_uploaded_file(skill_md_path.resolve(), _join_drive_key(drive_path, _SKILL_MD_FILENAME)),
                _prepare_uploaded_file(archive_path, _join_drive_key(drive_path, _SKILL_ARCHIVE_FILENAME)),
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


def _format_manifest(response: AgentStubDriveManifestResponse) -> str:
    return "\n".join(_format_manifest_item(item) for item in response.items)


def _format_manifest_item(item: AgentStubDriveItem) -> str:
    size = str(item.size) if item.size is not None else "-"
    mime_type = item.mime_type or "-"
    item_hash = item.hash or "-"
    return f"{size}\t{mime_type}\t{item_hash}\t{item.key}"


def _resolve_drive_destination(base_path: Path, drive_key: str) -> Path:
    destination = (base_path / Path(drive_key)).resolve()
    try:
        destination.relative_to(base_path)
    except ValueError as exc:
        raise AgentStubValidationError(f"drive key resolves outside the drive base: {drive_key}") from exc
    return destination


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
            raise AgentStubValidationError(f"drive push file resolves outside the source directory: {candidate}") from exc
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
    "list_drive_from_environment",
    "pull_drive_from_environment",
    "push_drive_from_environment",
]
