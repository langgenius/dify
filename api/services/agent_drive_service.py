"""Agent 网盘 (agent drive) service — list/manifest + commit with lifecycle (ENG-591).

The agent drive is a per-agent path-like KV index over existing UploadFile /
ToolFile records (see ``AgentDriveFile``). This service is the control plane:

* ``manifest`` lists a drive (optionally with download URLs). Download URLs use
  **drive-owned** semantics — tenant-scoped resolution only, NOT a user-level
  ``FileAccessScope`` (Agent Files §3.1.2). We reuse the standard
  ``file_factory.build_from_mapping`` + ``resolve_file_url`` rebuild, which always
  filters by ``tenant_id`` in the builders, so omitting the scope is safe.
* ``commit`` binds a batch of existing file refs to keys. Source ToolFiles must
  belong to the current run user. Overwriting a key whose previous value is
  ``value_owned_by_drive`` physically cleans the old value (storage + record),
  unless another drive entry still references it. Re-committing the same
  ``key -> file_ref`` is idempotent.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import DataError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.app.file_access.controller import DatabaseFileAccessController
from core.app.workflow.file_runtime import DifyWorkflowFileRuntime
from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from factories import file_factory
from libs.uuid_utils import uuidv7
from models.agent import Agent, AgentDriveFile, AgentDriveFileKind
from models.model import UploadFile
from models.tools import ToolFile

logger = logging.getLogger(__name__)

_MAX_KEY_LENGTH = 512
_DRIVE_REF_PREFIX = "agent-"


class AgentDriveError(Exception):
    """A drive operation failure mapped to an HTTP status by the controller."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class DriveFileRef(BaseModel):
    kind: Literal["upload_file", "tool_file"]
    id: str


class DriveCommitItem(BaseModel):
    key: str
    file_ref: DriveFileRef
    # Drive-owned values may be physically cleaned on overwrite/removal; refs to
    # files shared with other business records should set this False.
    value_owned_by_drive: bool = True


def parse_agent_drive_ref(drive_ref: str) -> str:
    """Parse an ``agent-<agent_id>`` URL drive ref into the agent id."""
    if not drive_ref.startswith(_DRIVE_REF_PREFIX):
        raise AgentDriveError("invalid_drive_ref", "drive ref must be 'agent-<agent_id>'", status_code=400)
    agent_id = drive_ref[len(_DRIVE_REF_PREFIX) :]
    if not agent_id:
        raise AgentDriveError("invalid_drive_ref", "drive ref must include an agent id", status_code=400)
    return agent_id


def normalize_drive_key(key: str) -> str:
    """Validate + normalize a path-like drive key (Agent Files §6 key safety).

    The key maps back to a sandbox-relative file path, so reject anything that
    could escape or break the path: empty, too long, NUL/control chars, absolute
    paths, or ``..`` segments. Collapse repeated slashes and strip a leading one.
    """
    if not isinstance(key, str) or not key.strip():
        raise AgentDriveError("invalid_key", "drive key must be a non-empty string", status_code=400)
    if len(key) > _MAX_KEY_LENGTH:
        raise AgentDriveError("invalid_key", f"drive key exceeds {_MAX_KEY_LENGTH} chars", status_code=400)
    if "\x00" in key or any(ord(ch) < 0x20 for ch in key):
        raise AgentDriveError("invalid_key", "drive key contains control characters", status_code=400)
    normalized = re.sub(r"/{2,}", "/", key.strip()).lstrip("/")
    segments = normalized.split("/")
    if any(segment == ".." for segment in segments):
        raise AgentDriveError("invalid_key", "drive key must not contain '..' segments", status_code=400)
    if not normalized:
        raise AgentDriveError("invalid_key", "drive key must be a non-empty path", status_code=400)
    return normalized


class AgentDriveService:
    """List/commit files in a per-agent drive (tenant_id -> agent-<agent_id>)."""

    def manifest(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        prefix: str = "",
        include_download_url: bool = False,
    ) -> list[dict[str, Any]]:
        with session_factory.create_session() as session:
            self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
            stmt = (
                select(AgentDriveFile)
                .where(AgentDriveFile.tenant_id == tenant_id, AgentDriveFile.agent_id == agent_id)
                .order_by(AgentDriveFile.key)
            )
            if prefix:
                stmt = stmt.where(AgentDriveFile.key.startswith(prefix))
            rows = list(session.scalars(stmt))
            items: list[dict[str, Any]] = []
            for row in rows:
                item: dict[str, Any] = {
                    "key": row.key,
                    "size": row.size,
                    "hash": row.hash,
                    "mime_type": row.mime_type,
                    "file_kind": row.file_kind.value,
                    "file_id": row.file_id,
                    "created_at": int(row.created_at.timestamp()) if row.created_at else None,
                }
                if include_download_url:
                    item["download_url"] = self._resolve_download_url(
                        tenant_id=tenant_id, file_kind=row.file_kind, file_id=row.file_id
                    )
                items.append(item)
            return items

    def commit(
        self,
        *,
        tenant_id: str,
        user_id: str,
        agent_id: str,
        items: list[DriveCommitItem],
    ) -> list[dict[str, Any]]:
        if not items:
            raise AgentDriveError("empty_commit", "commit requires at least one item", status_code=400)
        committed: list[dict[str, Any]] = []
        pending_storage_deletes: list[str] = []
        with session_factory.create_session() as session:
            self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
            for item in items:
                committed.append(
                    self._commit_one(
                        session,
                        tenant_id=tenant_id,
                        user_id=user_id,
                        agent_id=agent_id,
                        item=item,
                        pending_storage_deletes=pending_storage_deletes,
                    )
                )
            session.commit()
        for storage_key in pending_storage_deletes:
            self._delete_storage(storage_key)
        return committed

    def delete(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        prefix: str | None = None,
        key: str | None = None,
    ) -> list[str]:
        """Delete drive entries by exact ``key`` or by ``prefix`` (ENG-625 D5).

        Drive-owned values get their backing record + storage object cleaned via
        the same ``_cleanup_value`` path commit-overwrite uses; shared values only
        lose the KV row. Idempotent: deleting nothing returns ``[]``.
        """
        if (prefix is None) == (key is None):
            raise AgentDriveError("invalid_delete_scope", "delete requires exactly one of prefix or key")
        removed_keys: list[str] = []
        pending_storage_deletes: list[str] = []
        with session_factory.create_session() as session:
            self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
            stmt = select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.agent_id == agent_id,
            )
            if key is not None:
                stmt = stmt.where(AgentDriveFile.key == normalize_drive_key(key))
            else:
                stmt = stmt.where(AgentDriveFile.key.startswith(normalize_drive_key(prefix or "")))
            rows = list(session.scalars(stmt))
            for row in rows:
                if row.value_owned_by_drive:
                    self._cleanup_value(
                        session,
                        tenant_id=tenant_id,
                        file_kind=row.file_kind,
                        file_id=row.file_id,
                        exclude_row_id=row.id,
                        pending_storage_deletes=pending_storage_deletes,
                    )
                removed_keys.append(row.key)
                session.delete(row)
            session.commit()
        for storage_key in pending_storage_deletes:
            self._delete_storage(storage_key)
        return removed_keys

    def _commit_one(
        self,
        session: Session,
        *,
        tenant_id: str,
        user_id: str,
        agent_id: str,
        item: DriveCommitItem,
        pending_storage_deletes: list[str],
    ) -> dict[str, Any]:
        key = normalize_drive_key(item.key)
        file_kind = AgentDriveFileKind(item.file_ref.kind)
        file_id = item.file_ref.id
        size, mime_type = self._validate_source(
            session, tenant_id=tenant_id, user_id=user_id, file_kind=file_kind, file_id=file_id
        )

        existing = session.scalar(
            select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.agent_id == agent_id,
                AgentDriveFile.key == key,
            )
        )
        if existing is not None:
            # Idempotent re-commit of the same value: leave it (do not clean).
            if existing.file_kind == file_kind and existing.file_id == file_id:
                existing.value_owned_by_drive = item.value_owned_by_drive
                return self._row_dict(existing)
            # Overwrite: clean the previous drive-owned value if no longer referenced.
            if existing.value_owned_by_drive:
                self._cleanup_value(
                    session,
                    tenant_id=tenant_id,
                    file_kind=existing.file_kind,
                    file_id=existing.file_id,
                    exclude_row_id=existing.id,
                    pending_storage_deletes=pending_storage_deletes,
                )
            existing.file_kind = file_kind
            existing.file_id = file_id
            existing.value_owned_by_drive = item.value_owned_by_drive
            existing.size = size
            existing.mime_type = mime_type
            return self._row_dict(existing)

        row = AgentDriveFile(
            id=str(uuidv7()),
            tenant_id=tenant_id,
            agent_id=agent_id,
            key=key,
            file_kind=file_kind,
            file_id=file_id,
            value_owned_by_drive=item.value_owned_by_drive,
            size=size,
            mime_type=mime_type,
            created_by=user_id,
        )
        session.add(row)
        return self._row_dict(row)

    @staticmethod
    def _row_dict(row: AgentDriveFile) -> dict[str, Any]:
        return {
            "key": row.key,
            "file_kind": row.file_kind.value,
            "file_id": row.file_id,
            "size": row.size,
            "mime_type": row.mime_type,
            "value_owned_by_drive": row.value_owned_by_drive,
        }

    @staticmethod
    def _assert_agent_belongs_to_tenant(session: Session, *, tenant_id: str, agent_id: str) -> None:
        try:
            found_agent_id = session.scalar(select(Agent.id).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentDriveError(
                "agent_not_found", "agent drive does not belong to this tenant", status_code=404
            ) from exc
        if found_agent_id is None:
            raise AgentDriveError("agent_not_found", "agent drive does not belong to this tenant", status_code=404)

    def _validate_source(
        self,
        session: Session,
        *,
        tenant_id: str,
        user_id: str,
        file_kind: AgentDriveFileKind,
        file_id: str,
    ) -> tuple[int | None, str | None]:
        """Verify the source file exists for the tenant (and user, for ToolFile).

        Malformed ids (e.g. a non-UUID hitting a UUID column) are treated as a
        missing source rather than crashing the commit with a 500.
        """
        try:
            if file_kind == AgentDriveFileKind.TOOL_FILE:
                tool_file = session.scalar(
                    select(ToolFile).where(
                        ToolFile.id == file_id,
                        ToolFile.tenant_id == tenant_id,
                        ToolFile.user_id == user_id,
                    )
                )
                if tool_file is None:
                    raise AgentDriveError(
                        "source_not_found", "source ToolFile not found for this tenant/user", status_code=404
                    )
                return tool_file.size, tool_file.mimetype
            upload_file = session.scalar(
                select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id)
            )
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentDriveError("source_not_found", "source file ref is invalid", status_code=404) from exc
        if upload_file is None:
            raise AgentDriveError("source_not_found", "source UploadFile not found for this tenant", status_code=404)
        return upload_file.size, upload_file.mime_type

    def _cleanup_value(
        self,
        session: Session,
        *,
        tenant_id: str,
        file_kind: AgentDriveFileKind,
        file_id: str,
        exclude_row_id: str,
        pending_storage_deletes: list[str],
    ) -> None:
        """Physically delete a drive-owned value, unless another drive entry references it."""
        still_referenced = session.scalar(
            select(func.count())
            .select_from(AgentDriveFile)
            .where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.file_kind == file_kind,
                AgentDriveFile.file_id == file_id,
                AgentDriveFile.id != exclude_row_id,
            )
        )
        if still_referenced:
            return
        if file_kind == AgentDriveFileKind.TOOL_FILE:
            tool_file = session.scalar(select(ToolFile).where(ToolFile.id == file_id, ToolFile.tenant_id == tenant_id))
            if tool_file is not None:
                pending_storage_deletes.append(tool_file.file_key)
                session.delete(tool_file)
            return
        upload_file = session.scalar(
            select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id)
        )
        if upload_file is not None:
            pending_storage_deletes.append(upload_file.key)
            session.delete(upload_file)

    @staticmethod
    def _delete_storage(storage_key: str | None) -> None:
        if not storage_key:
            return
        try:
            storage.delete(storage_key)
        except Exception:
            # Best-effort: a missing/already-deleted object must not abort the commit.
            logger.warning("failed to delete drive storage object %s", storage_key, exc_info=True)

    @staticmethod
    def _resolve_download_url(
        *, tenant_id: str, file_kind: AgentDriveFileKind, file_id: str, for_external: bool = False
    ) -> str | None:
        """Signed URL for a drive value. ``for_external`` selects the audience:
        the inner manifest hands agents *internal* URLs, while the console
        inspector must hand browsers *external* ones — never mix the two."""
        if file_kind == AgentDriveFileKind.TOOL_FILE:
            mapping: dict[str, Any] = {"transfer_method": "tool_file", "tool_file_id": file_id}
        else:
            mapping = {"transfer_method": "local_file", "upload_file_id": file_id}
        controller = DatabaseFileAccessController()
        runtime = DifyWorkflowFileRuntime(file_access_controller=controller)
        try:
            # No FileAccessScope bound -> drive-owned: the builders still filter by
            # tenant_id, so resolution is tenant-scoped without user-level checks.
            file = file_factory.build_from_mapping(mapping=mapping, tenant_id=tenant_id, access_controller=controller)
            return runtime.resolve_file_url(file=file, for_external=for_external)
        except ValueError:
            return None

    # ── console drive inspector (ENG-624) ────────────────────────────────────

    # SKILL.md is the primary preview use case; 64 KiB covers it with headroom
    # while keeping the console payload bounded.
    PREVIEW_MAX_BYTES = 64 * 1024

    def _require_row(self, session: Session, *, tenant_id: str, agent_id: str, key: str) -> AgentDriveFile:
        row = session.scalar(
            select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.agent_id == agent_id,
                AgentDriveFile.key == normalize_drive_key(key),
            )
        )
        if row is None:
            raise AgentDriveError("drive_key_not_found", "no drive entry for this key", status_code=404)
        return row

    def _storage_key_for_row(self, session: Session, *, tenant_id: str, row: AgentDriveFile) -> str:
        if row.file_kind == AgentDriveFileKind.TOOL_FILE:
            tool_file = session.scalar(
                select(ToolFile).where(ToolFile.id == row.file_id, ToolFile.tenant_id == tenant_id)
            )
            if tool_file is None:
                raise AgentDriveError("drive_key_not_found", "drive value record is missing", status_code=404)
            return tool_file.file_key
        upload_file = session.scalar(
            select(UploadFile).where(UploadFile.id == row.file_id, UploadFile.tenant_id == tenant_id)
        )
        if upload_file is None:
            raise AgentDriveError("drive_key_not_found", "drive value record is missing", status_code=404)
        return upload_file.key

    def preview(self, *, tenant_id: str, agent_id: str, key: str) -> dict[str, Any]:
        """Truncated text preview of one drive value (binary-safe, never 500s on size)."""
        with session_factory.create_session() as session:
            self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
            row = self._require_row(session, tenant_id=tenant_id, agent_id=agent_id, key=key)
            storage_key = self._storage_key_for_row(session, tenant_id=tenant_id, row=row)
            size = row.size

        data = bytearray()
        for chunk in storage.load_stream(storage_key):
            data.extend(chunk)
            if len(data) > self.PREVIEW_MAX_BYTES:
                break
        truncated = len(data) > self.PREVIEW_MAX_BYTES
        sample = bytes(data[: self.PREVIEW_MAX_BYTES])
        # Same semantics as the sandbox read endpoint: NUL or undecodable -> binary.
        if b"\x00" in sample:
            return {"key": row.key, "size": size, "truncated": truncated, "binary": True, "text": None}
        try:
            text = sample.decode("utf-8")
        except UnicodeDecodeError:
            if truncated:
                # A multi-byte char may sit on the cut point; retry without the tail.
                try:
                    text = sample[:-3].decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    return {"key": row.key, "size": size, "truncated": truncated, "binary": True, "text": None}
            else:
                return {"key": row.key, "size": size, "truncated": truncated, "binary": True, "text": None}
        return {"key": row.key, "size": size, "truncated": truncated, "binary": False, "text": text}

    def download_url(self, *, tenant_id: str, agent_id: str, key: str) -> str:
        """External signed URL for a browser download of one drive value."""
        with session_factory.create_session() as session:
            self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
            row = self._require_row(session, tenant_id=tenant_id, agent_id=agent_id, key=key)
            url = self._resolve_download_url(
                tenant_id=tenant_id, file_kind=row.file_kind, file_id=row.file_id, for_external=True
            )
        if url is None:
            raise AgentDriveError("drive_key_not_found", "drive value cannot be resolved", status_code=404)
        return url


__all__ = [
    "AgentDriveError",
    "AgentDriveService",
    "DriveCommitItem",
    "DriveFileRef",
    "normalize_drive_key",
    "parse_agent_drive_ref",
]
