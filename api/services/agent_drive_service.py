"""Agent 网盘 (agent drive) service — manifest/catalog + commit lifecycle.

The agent drive is a per-agent path-like KV index over existing UploadFile /
ToolFile records (see ``AgentDriveFile``). This service is the control plane:

* ``manifest`` lists a drive (optionally with download URLs). Download URLs use
  **drive-owned** semantics — tenant-scoped resolution only, NOT a user-level
  ``FileAccessScope`` (Agent Files §3.1.2). We reuse the standard
  ``file_factory.build_from_mapping`` + ``resolve_file_url`` rebuild, which always
  filters by ``tenant_id`` in the builders, so omitting the scope is safe.
* ``commit`` is the single mutation entry point for writes and removals.
  ``file_ref=None`` removes an exact key idempotently; otherwise the service
  binds the referenced UploadFile/ToolFile to the key. Source ToolFiles must
  belong to the current run user. Overwriting a key whose previous value is
  ``value_owned_by_drive`` physically cleans the old value (storage + record),
  unless another drive entry still references it. Re-committing the same
  ``key -> file_ref`` is idempotent and still refreshes skill metadata.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import mimetypes
import os
import re
import time
import urllib.parse
import zipfile
from typing import Any, Literal, TypedDict
from urllib.parse import unquote

from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import DataError, SQLAlchemyError
from sqlalchemy.orm import Session, scoped_session

from configs import dify_config
from core.app.file_access.controller import DatabaseFileAccessController
from extensions.ext_storage import storage
from factories import file_factory
from libs.uuid_utils import uuidv7
from models.agent import Agent, AgentDriveFile, AgentDriveFileKind
from models.model import UploadFile
from models.tools import ToolFile

logger = logging.getLogger(__name__)

_MAX_KEY_LENGTH = 512
_DRIVE_REF_PREFIX = "agent-"
_SKILL_MD_SUFFIX = "/SKILL.md"
_SKILL_ARCHIVE_NAME = ".DIFY-SKILL-FULL.zip"
_ARCHIVE_MEMBER_DOWNLOAD_PURPOSE = "agent-drive-archive-member"


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
    model_config = ConfigDict(extra="forbid")

    kind: Literal["upload_file", "tool_file"]
    id: str


class DriveSkillMetadata(BaseModel):
    """Validated skill catalog metadata stored as a JSON string on the drive row."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str = ""
    # Safe archive member paths captured during skill standardization. The drive
    # stores only canonical SKILL.md + full archive, so the UI uses this manifest
    # to show the original uploaded package contents.
    manifest_files: list[str] | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("skill metadata name must not be blank")
        return normalized


class DriveCommitItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    file_ref: DriveFileRef | None = None
    # Drive-owned values may be physically cleaned on overwrite/removal; refs to
    # files shared with other business records should set this False.
    value_owned_by_drive: bool = True
    is_skill: bool = False
    skill_metadata: DriveSkillMetadata | None = None


class AgentDriveSkillInfo(TypedDict):
    path: str
    skill_md_key: str
    archive_key: str | None
    name: str
    description: str
    size: int | None
    mime_type: str | None
    hash: str | None
    created_at: int | None


class AgentDriveSkillFileInfo(TypedDict):
    path: str
    name: str
    type: str
    drive_key: str | None
    available_in_drive: bool


class AgentDriveSkillInspectInfo(TypedDict):
    path: str
    skill_md_key: str
    archive_key: str | None
    name: str
    description: str
    size: int | None
    mime_type: str | None
    hash: str | None
    created_at: int | None
    source: str
    files: list[AgentDriveSkillFileInfo]
    file_tree: list[dict[str, Any]]
    skill_md: dict[str, Any]
    warnings: list[str]


def decode_drive_mention_ref(ref_id: str) -> str:
    """Decode the prompt token's URL-encoded drive-key field."""

    return unquote(ref_id or "")


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
        session: Session | scoped_session,
        prefix: str = "",
        include_download_url: bool = False,
    ) -> list[dict[str, Any]]:
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
                "is_skill": row.is_skill,
                "skill_metadata": row.skill_metadata,
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
        session: Session | scoped_session,
    ) -> list[dict[str, Any]]:
        if not items:
            raise AgentDriveError("empty_commit", "commit requires at least one item", status_code=400)
        committed: list[dict[str, Any]] = []
        pending_storage_deletes: list[str] = []
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
        session: Session | scoped_session,
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

    def list_skills(
        self, *, tenant_id: str, agent_id: str, session: Session | scoped_session
    ) -> list[AgentDriveSkillInfo]:
        """Return the drive-backed skill catalog derived from canonical ``SKILL.md`` rows."""

        self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
        skill_rows = list(
            session.scalars(
                select(AgentDriveFile)
                .where(
                    AgentDriveFile.tenant_id == tenant_id,
                    AgentDriveFile.agent_id == agent_id,
                    AgentDriveFile.is_skill.is_(True),
                )
                .order_by(AgentDriveFile.key)
            )
        )
        archive_keys = set(
            session.scalars(
                select(AgentDriveFile.key).where(
                    AgentDriveFile.tenant_id == tenant_id,
                    AgentDriveFile.agent_id == agent_id,
                    AgentDriveFile.key.in_([self._skill_archive_key(row.key) for row in skill_rows]),
                )
            )
        )

        skills: list[AgentDriveSkillInfo] = []
        for row in skill_rows:
            metadata = self._parse_skill_metadata(row.key, row.skill_metadata)
            archive_key = self._skill_archive_key(row.key)
            skills.append(
                {
                    "path": self._skill_path_from_key(row.key),
                    "skill_md_key": row.key,
                    "archive_key": archive_key if archive_key in archive_keys else None,
                    "name": metadata.name,
                    "description": metadata.description,
                    "size": row.size,
                    "mime_type": row.mime_type,
                    "hash": row.hash,
                    "created_at": int(row.created_at.timestamp()) if row.created_at else None,
                }
            )
        return skills

    def inspect_skill(
        self, *, tenant_id: str, agent_id: str, skill_path: str, session: Session | scoped_session
    ) -> AgentDriveSkillInspectInfo:
        """Return the UI-facing skill inspect view for slash-menu hover/detail."""

        skill_path = normalize_drive_key(skill_path)
        skill_md_key = skill_path if skill_path.endswith(_SKILL_MD_SUFFIX) else f"{skill_path}{_SKILL_MD_SUFFIX}"
        skill_path = self._skill_path_from_key(skill_md_key)
        catalog = next(
            (
                item
                for item in self.list_skills(tenant_id=tenant_id, agent_id=agent_id, session=session)
                if item["path"] == skill_path
            ),
            None,
        )
        if catalog is None:
            raise AgentDriveError("skill_not_found", "no drive-backed skill for this path", status_code=404)

        manifest_files = self._manifest_files_from_skill_metadata(
            tenant_id=tenant_id,
            agent_id=agent_id,
            skill_md_key=skill_md_key,
            session=session,
        )
        drive_items = self.manifest(tenant_id=tenant_id, agent_id=agent_id, prefix=f"{skill_path}/", session=session)
        drive_keys = {item["key"] for item in drive_items}
        preview = self.preview(tenant_id=tenant_id, agent_id=agent_id, key=skill_md_key, session=session)
        files, warnings = self._skill_file_entries(
            skill_path=skill_path,
            skill_md_key=skill_md_key,
            manifest_files=manifest_files,
            drive_keys=drive_keys,
            archive_available=catalog["archive_key"] in drive_keys if catalog["archive_key"] else False,
        )
        return {
            **catalog,
            "source": "skill_md",
            "files": files,
            "file_tree": self._build_file_tree(files),
            "skill_md": preview,
            "warnings": warnings,
        }

    def _commit_one(
        self,
        session: Session | scoped_session,
        *,
        tenant_id: str,
        user_id: str,
        agent_id: str,
        item: DriveCommitItem,
        pending_storage_deletes: list[str],
    ) -> dict[str, Any]:
        key = normalize_drive_key(item.key)
        if item.file_ref is None:
            return self._remove_one(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                key=key,
                pending_storage_deletes=pending_storage_deletes,
            )

        skill_metadata = self._validate_skill_commit_fields(key=key, item=item)
        file_kind = AgentDriveFileKind(item.file_ref.kind)
        file_id = item.file_ref.id
        size, mime_type, file_hash = self._validate_source(
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
                existing.is_skill = item.is_skill
                existing.skill_metadata = skill_metadata
                existing.size = size
                existing.mime_type = mime_type
                existing.hash = file_hash
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
            existing.is_skill = item.is_skill
            existing.skill_metadata = skill_metadata
            existing.size = size
            existing.hash = file_hash
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
            is_skill=item.is_skill,
            skill_metadata=skill_metadata,
            size=size,
            hash=file_hash,
            mime_type=mime_type,
            created_by=user_id,
        )
        session.add(row)
        return self._row_dict(row)

    def _remove_one(
        self,
        session: Session | scoped_session,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
        pending_storage_deletes: list[str],
    ) -> dict[str, Any]:
        existing = session.scalar(
            select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.agent_id == agent_id,
                AgentDriveFile.key == key,
            )
        )
        if existing is None:
            return {"key": key, "removed": True, "noop": True}
        result = {
            "key": key,
            "removed": True,
            "file_kind": existing.file_kind.value,
            "file_id": existing.file_id,
            "value_owned_by_drive": existing.value_owned_by_drive,
            "is_skill": existing.is_skill,
            "skill_metadata": existing.skill_metadata,
        }
        if existing.value_owned_by_drive:
            self._cleanup_value(
                session,
                tenant_id=tenant_id,
                file_kind=existing.file_kind,
                file_id=existing.file_id,
                exclude_row_id=existing.id,
                pending_storage_deletes=pending_storage_deletes,
            )
        session.delete(existing)
        return result

    @staticmethod
    def _row_dict(row: AgentDriveFile) -> dict[str, Any]:
        return {
            "key": row.key,
            "file_kind": row.file_kind.value,
            "file_id": row.file_id,
            "size": row.size,
            "mime_type": row.mime_type,
            "value_owned_by_drive": row.value_owned_by_drive,
            "is_skill": row.is_skill,
            "skill_metadata": row.skill_metadata,
        }

    @staticmethod
    def _skill_path_from_key(key: str) -> str:
        if not key.endswith(_SKILL_MD_SUFFIX):
            raise AgentDriveError(
                "invalid_skill_key",
                "skill rows must use the canonical '<path>/SKILL.md' key",
                status_code=500,
            )
        path = key[: -len(_SKILL_MD_SUFFIX)]
        if not path:
            raise AgentDriveError(
                "invalid_skill_key",
                "skill rows must use the canonical '<path>/SKILL.md' key",
                status_code=500,
            )
        return path

    @classmethod
    def _skill_archive_key(cls, key: str) -> str:
        return f"{cls._skill_path_from_key(key)}/{_SKILL_ARCHIVE_NAME}"

    @classmethod
    def _validate_skill_commit_fields(cls, *, key: str, item: DriveCommitItem) -> str | None:
        if not item.is_skill:
            if item.skill_metadata is not None:
                raise AgentDriveError(
                    "invalid_skill_metadata",
                    "skill metadata is only allowed for canonical skill rows",
                    status_code=400,
                )
            return None
        cls._skill_path_from_key(key)
        if item.skill_metadata is None:
            raise AgentDriveError(
                "invalid_skill_metadata",
                "skill metadata is required for canonical skill rows",
                status_code=400,
            )
        return json.dumps(
            item.skill_metadata.model_dump(mode="json", exclude_none=True),
            separators=(",", ":"),
            sort_keys=True,
        )

    @staticmethod
    def _parse_skill_metadata(key: str, raw_metadata: str | None) -> DriveSkillMetadata:
        if raw_metadata is None:
            raise AgentDriveError(
                "invalid_skill_metadata",
                f"skill row '{key}' is missing required metadata",
                status_code=500,
            )
        try:
            return DriveSkillMetadata.model_validate(json.loads(raw_metadata))
        except (ValueError, TypeError) as exc:
            raise AgentDriveError(
                "invalid_skill_metadata",
                f"skill row '{key}' has invalid stored metadata",
                status_code=500,
            ) from exc

    @staticmethod
    def _manifest_files_from_skill_metadata(
        *, tenant_id: str, agent_id: str, skill_md_key: str, session: Session | scoped_session
    ) -> list[str] | None:
        row = session.scalar(
            select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.agent_id == agent_id,
                AgentDriveFile.key == skill_md_key,
                AgentDriveFile.is_skill.is_(True),
            )
        )
        if row is None:
            return None
        try:
            metadata = AgentDriveService._parse_skill_metadata(row.key, row.skill_metadata)
        except Exception:
            logger.warning("drive skill inspect: malformed skill metadata for %s", skill_md_key, exc_info=True)
            return None
        return [str(item) for item in (metadata.manifest_files or []) if str(item).strip()] or None

    @classmethod
    def _skill_file_entries(
        cls,
        *,
        skill_path: str,
        skill_md_key: str,
        manifest_files: list[str] | None,
        drive_keys: set[str],
        archive_available: bool = False,
    ) -> tuple[list[AgentDriveSkillFileInfo], list[str]]:
        warnings: list[str] = []
        if manifest_files:
            paths = sorted({normalize_drive_key(path) for path in manifest_files})
        else:
            paths = sorted(
                {
                    key.removeprefix(f"{skill_path}/")
                    for key in drive_keys
                    if not key.endswith(f"/{_SKILL_ARCHIVE_NAME}")
                }
            )
            warnings.append("manifest_files_unavailable")

        files: list[AgentDriveSkillFileInfo] = []
        for path in paths:
            if path == _SKILL_ARCHIVE_NAME:
                continue
            drive_key = f"{skill_path}/{path}"
            available_in_drive = drive_key in drive_keys or (archive_available and path != _SKILL_ARCHIVE_NAME)
            files.append(
                {
                    "path": path,
                    "name": path.rsplit("/", 1)[-1],
                    "type": "file",
                    "drive_key": drive_key if available_in_drive else None,
                    "available_in_drive": available_in_drive,
                }
            )
        if "SKILL.md" not in {file["path"] for file in files}:
            files.insert(
                0,
                {
                    "path": "SKILL.md",
                    "name": "SKILL.md",
                    "type": "file",
                    "drive_key": skill_md_key,
                    "available_in_drive": skill_md_key in drive_keys,
                },
            )
        return files, warnings

    @staticmethod
    def _build_file_tree(files: list[AgentDriveSkillFileInfo]) -> list[dict[str, Any]]:
        root: dict[str, Any] = {}
        for file in files:
            cursor = root
            parts = [part for part in file["path"].split("/") if part]
            path_parts: list[str] = []
            for part in parts[:-1]:
                path_parts.append(part)
                directory = cursor.setdefault(
                    part,
                    {
                        "name": part,
                        "path": "/".join(path_parts),
                        "type": "directory",
                        "children": {},
                    },
                )
                cursor = directory["children"]
            leaf_name = parts[-1] if parts else file["name"]
            cursor[leaf_name] = {
                "name": leaf_name,
                "path": file["path"],
                "type": file["type"],
                "drive_key": file["drive_key"],
                "available_in_drive": file["available_in_drive"],
            }

        def serialize(node: dict[str, Any]) -> list[dict[str, Any]]:
            result: list[dict[str, Any]] = []
            for item in sorted(node.values(), key=lambda value: (value["type"] != "directory", value["name"])):
                if item["type"] == "directory":
                    children = serialize(item["children"])
                    result.append(
                        {
                            "name": item["name"],
                            "path": item["path"],
                            "type": "directory",
                            "children": children,
                        }
                    )
                else:
                    result.append(item)
            return result

        return serialize(root)

    @staticmethod
    def _assert_agent_belongs_to_tenant(session: Session | scoped_session, *, tenant_id: str, agent_id: str) -> None:
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
        session: Session | scoped_session,
        *,
        tenant_id: str,
        user_id: str,
        file_kind: AgentDriveFileKind,
        file_id: str,
    ) -> tuple[int | None, str | None, str | None]:
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
                return tool_file.size, tool_file.mimetype, None
            upload_file = session.scalar(
                select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id)
            )
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentDriveError("source_not_found", "source file ref is invalid", status_code=404) from exc
        if upload_file is None:
            raise AgentDriveError("source_not_found", "source UploadFile not found for this tenant", status_code=404)
        return upload_file.size, upload_file.mime_type, upload_file.hash

    def _cleanup_value(
        self,
        session: Session | scoped_session,
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
        *,
        tenant_id: str,
        file_kind: AgentDriveFileKind,
        file_id: str,
        for_external: bool = False,
        as_attachment: bool = False,
    ) -> str | None:
        """Signed URL for a drive value. ``for_external`` selects the audience:
        the inner manifest hands agents *internal* URLs, while the console
        inspector must hand browsers *external* ones — never mix the two."""
        if file_kind == AgentDriveFileKind.TOOL_FILE:
            mapping: dict[str, Any] = {"transfer_method": "tool_file", "tool_file_id": file_id}
        else:
            mapping = {"transfer_method": "local_file", "upload_file_id": file_id}
        controller = DatabaseFileAccessController()
        # Keep workflow runtime wiring lazy: importing this service is part of
        # Agent v2 node bootstrap, while ``core.app.workflow`` re-exports the
        # node factory. A module-level import here would close that cycle.
        from core.app.workflow.file_runtime import DifyWorkflowFileRuntime

        runtime = DifyWorkflowFileRuntime(file_access_controller=controller)
        try:
            if file_kind == AgentDriveFileKind.UPLOAD_FILE:
                return runtime.resolve_upload_file_url(
                    upload_file_id=file_id,
                    for_external=for_external,
                    as_attachment=as_attachment,
                )
            # No FileAccessScope bound -> drive-owned: the builders still filter by
            # tenant_id, so resolution is tenant-scoped without user-level checks.
            file = file_factory.build_from_mapping(mapping=mapping, tenant_id=tenant_id, access_controller=controller)
            url = runtime.resolve_file_url(file=file, for_external=for_external)
            if as_attachment and url:
                parsed = urllib.parse.urlsplit(url)
                query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
                query.append(("as_attachment", "true"))
                return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
            return url
        except ValueError:
            return None

    # ── console drive inspector (ENG-624) ────────────────────────────────────

    # SKILL.md is the primary preview use case; 64 KiB covers it with headroom
    # while keeping the console payload bounded.
    PREVIEW_MAX_BYTES = 64 * 1024

    def _require_row(
        self, session: Session | scoped_session, *, tenant_id: str, agent_id: str, key: str
    ) -> AgentDriveFile:
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

    def _storage_key_for_row(self, session: Session | scoped_session, *, tenant_id: str, row: AgentDriveFile) -> str:
        return self._storage_key_for_ref(
            session,
            tenant_id=tenant_id,
            file_kind=row.file_kind,
            file_id=row.file_id,
        )

    def _storage_key_for_ref(
        self,
        session: Session | scoped_session,
        *,
        tenant_id: str,
        file_kind: AgentDriveFileKind,
        file_id: str,
    ) -> str:
        if file_kind == AgentDriveFileKind.TOOL_FILE:
            tool_file = session.scalar(select(ToolFile).where(ToolFile.id == file_id, ToolFile.tenant_id == tenant_id))
            if tool_file is None:
                raise AgentDriveError("drive_key_not_found", "drive value record is missing", status_code=404)
            return tool_file.file_key
        upload_file = session.scalar(
            select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id)
        )
        if upload_file is None:
            raise AgentDriveError("drive_key_not_found", "drive value record is missing", status_code=404)
        return upload_file.key

    def _archive_member_for_key(
        self,
        session: Session | scoped_session,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
    ) -> tuple[AgentDriveFile, str]:
        normalized_key = normalize_drive_key(key)
        if "/" not in normalized_key:
            raise AgentDriveError("drive_key_not_found", "no drive entry for this key", status_code=404)
        skill_path, member_path = normalized_key.split("/", 1)
        if member_path in {_SKILL_ARCHIVE_NAME, ""}:
            raise AgentDriveError("drive_key_not_found", "no archive member for this key", status_code=404)

        skill_md_key = f"{skill_path}{_SKILL_MD_SUFFIX}"
        skill_row = session.scalar(
            select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.agent_id == agent_id,
                AgentDriveFile.key == skill_md_key,
                AgentDriveFile.is_skill.is_(True),
            )
        )
        if skill_row is None:
            raise AgentDriveError("drive_key_not_found", "no drive entry for this key", status_code=404)
        metadata = self._parse_skill_metadata(skill_row.key, skill_row.skill_metadata)
        manifest_files = {normalize_drive_key(path) for path in (metadata.manifest_files or [])}
        if member_path not in manifest_files:
            raise AgentDriveError("drive_key_not_found", "archive member is not part of this skill", status_code=404)
        archive_row = session.scalar(
            select(AgentDriveFile).where(
                AgentDriveFile.tenant_id == tenant_id,
                AgentDriveFile.agent_id == agent_id,
                AgentDriveFile.key == self._skill_archive_key(skill_md_key),
            )
        )
        if archive_row is None:
            raise AgentDriveError("drive_key_not_found", "skill archive is missing", status_code=404)
        return archive_row, member_path

    def _load_archive_member_bytes(
        self,
        *,
        tenant_id: str,
        archive_file_kind: AgentDriveFileKind,
        archive_file_id: str,
        member_path: str,
        session: Session | scoped_session,
    ) -> bytes:
        member_path = normalize_drive_key(member_path)
        storage_key = self._storage_key_for_ref(
            session,
            tenant_id=tenant_id,
            file_kind=archive_file_kind,
            file_id=archive_file_id,
        )
        archive_bytes = b"".join(storage.load_stream(storage_key))
        try:
            with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
                member = next(
                    (
                        info
                        for info in archive.infolist()
                        if not info.is_dir() and normalize_drive_key(info.filename) == member_path
                    ),
                    None,
                )
                if member is None:
                    raise AgentDriveError(
                        "drive_key_not_found", "archive member is missing from the skill archive", status_code=404
                    )
                return archive.read(member)
        except zipfile.BadZipFile as exc:
            raise AgentDriveError("invalid_skill_archive", "skill archive is not a valid zip", status_code=500) from exc

    @classmethod
    def _preview_bytes(cls, *, key: str, size: int | None, payload: bytes) -> dict[str, Any]:
        truncated = len(payload) > cls.PREVIEW_MAX_BYTES
        sample = payload[: cls.PREVIEW_MAX_BYTES]
        if b"\x00" in sample:
            return {"key": key, "size": size, "truncated": truncated, "binary": True, "text": None}
        try:
            text = sample.decode("utf-8")
        except UnicodeDecodeError:
            if truncated:
                try:
                    text = sample[:-3].decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    return {"key": key, "size": size, "truncated": truncated, "binary": True, "text": None}
            else:
                return {"key": key, "size": size, "truncated": truncated, "binary": True, "text": None}
        return {"key": key, "size": size, "truncated": truncated, "binary": False, "text": text}

    def preview(self, *, tenant_id: str, agent_id: str, key: str, session: Session | scoped_session) -> dict[str, Any]:
        """Truncated text preview of one drive value (binary-safe, never 500s on size)."""
        self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
        try:
            row = self._require_row(session, tenant_id=tenant_id, agent_id=agent_id, key=key)
            storage_key = self._storage_key_for_row(session, tenant_id=tenant_id, row=row)
            size = row.size
            response_key = row.key
            archive_ref: tuple[AgentDriveFile, str] | None = None
        except AgentDriveError:
            archive_ref = self._archive_member_for_key(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                key=key,
            )
            storage_key = None
            size = None
            response_key = normalize_drive_key(key)

        if archive_ref is not None:
            archive_row, member_path = archive_ref
            payload = self._load_archive_member_bytes(
                tenant_id=tenant_id,
                archive_file_kind=archive_row.file_kind,
                archive_file_id=archive_row.file_id,
                member_path=member_path,
                session=session,
            )
            return self._preview_bytes(key=response_key, size=len(payload), payload=payload)

        data = bytearray()
        assert storage_key is not None
        for chunk in storage.load_stream(storage_key):
            data.extend(chunk)
            if len(data) > self.PREVIEW_MAX_BYTES:
                break
        return self._preview_bytes(key=response_key, size=size, payload=bytes(data))

    def preview_archive_member_for_ref(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
        archive_file_kind: AgentDriveFileKind,
        archive_file_id: str,
        member_path: str,
        session: Session | scoped_session,
    ) -> dict[str, Any]:
        self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
        payload = self._load_archive_member_bytes(
            tenant_id=tenant_id,
            archive_file_kind=archive_file_kind,
            archive_file_id=archive_file_id,
            member_path=member_path,
            session=session,
        )
        return self._preview_bytes(key=normalize_drive_key(key), size=len(payload), payload=payload)

    def download_url(self, *, tenant_id: str, agent_id: str, key: str, session: Session | scoped_session) -> str:
        """External signed URL for a browser download of one drive value."""
        self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
        try:
            row = self._require_row(session, tenant_id=tenant_id, agent_id=agent_id, key=key)
        except AgentDriveError:
            archive_row, member_path = self._archive_member_for_key(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                key=key,
            )
            return self.sign_archive_member_url(
                tenant_id=tenant_id,
                agent_id=agent_id,
                key=key,
                archive_file_kind=archive_row.file_kind,
                archive_file_id=archive_row.file_id,
                member_path=member_path,
                for_external=True,
                as_attachment=True,
            )
        url = self._resolve_download_url(
            tenant_id=tenant_id,
            file_kind=row.file_kind,
            file_id=row.file_id,
            for_external=True,
            as_attachment=True,
        )
        if url is None:
            raise AgentDriveError("drive_key_not_found", "drive value cannot be resolved", status_code=404)
        return url

    def download_url_archive_member_for_ref(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
        archive_file_kind: AgentDriveFileKind,
        archive_file_id: str,
        member_path: str,
        session: Session | scoped_session,
        for_external: bool = True,
    ) -> str:
        self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
        return self.sign_archive_member_url(
            tenant_id=tenant_id,
            agent_id=agent_id,
            key=key,
            archive_file_kind=archive_file_kind,
            archive_file_id=archive_file_id,
            member_path=member_path,
            for_external=for_external,
            as_attachment=True,
        )

    @staticmethod
    def _secret_key() -> bytes:
        return dify_config.SECRET_KEY.encode()

    @classmethod
    def _archive_member_signature_payload(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
        archive_file_kind: AgentDriveFileKind,
        archive_file_id: str,
        member_path: str,
        timestamp: str,
        nonce: str,
    ) -> str:
        return "|".join(
            [
                _ARCHIVE_MEMBER_DOWNLOAD_PURPOSE,
                tenant_id,
                agent_id,
                normalize_drive_key(key),
                archive_file_kind.value,
                archive_file_id,
                normalize_drive_key(member_path),
                timestamp,
                nonce,
            ]
        )

    @classmethod
    def _sign_archive_member_payload(cls, payload: str) -> str:
        digest = hmac.new(cls._secret_key(), payload.encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).decode()

    @classmethod
    def sign_archive_member_url(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
        archive_file_kind: AgentDriveFileKind,
        archive_file_id: str,
        member_path: str,
        for_external: bool,
        as_attachment: bool = False,
    ) -> str:
        base_url = dify_config.FILES_URL if for_external else (dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL)
        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        payload = cls._archive_member_signature_payload(
            tenant_id=tenant_id,
            agent_id=agent_id,
            key=key,
            archive_file_kind=archive_file_kind,
            archive_file_id=archive_file_id,
            member_path=member_path,
            timestamp=timestamp,
            nonce=nonce,
        )
        query = urllib.parse.urlencode(
            {
                "tenant_id": tenant_id,
                "agent_id": agent_id,
                "key": normalize_drive_key(key),
                "archive_file_kind": archive_file_kind.value,
                "archive_file_id": archive_file_id,
                "member_path": normalize_drive_key(member_path),
                "timestamp": timestamp,
                "nonce": nonce,
                "sign": cls._sign_archive_member_payload(payload),
                "as_attachment": str(as_attachment).lower(),
            }
        )
        return f"{base_url}/files/agent-drive/archive-member?{query}"

    @classmethod
    def verify_archive_member_signature(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
        archive_file_kind: AgentDriveFileKind,
        archive_file_id: str,
        member_path: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> bool:
        payload = cls._archive_member_signature_payload(
            tenant_id=tenant_id,
            agent_id=agent_id,
            key=key,
            archive_file_kind=archive_file_kind,
            archive_file_id=archive_file_id,
            member_path=member_path,
            timestamp=timestamp,
            nonce=nonce,
        )
        if sign != cls._sign_archive_member_payload(payload):
            return False
        current_time = int(time.time())
        return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT

    def load_archive_member_for_signed_request(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        key: str,
        archive_file_kind: AgentDriveFileKind,
        archive_file_id: str,
        member_path: str,
        session: Session | scoped_session,
    ) -> tuple[bytes, str, str]:
        self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
        payload = self._load_archive_member_bytes(
            tenant_id=tenant_id,
            archive_file_kind=archive_file_kind,
            archive_file_id=archive_file_id,
            member_path=member_path,
            session=session,
        )
        mime_type = mimetypes.guess_type(member_path)[0] or "application/octet-stream"
        filename = normalize_drive_key(key).rsplit("/", 1)[-1]
        return payload, mime_type, filename


__all__ = [
    "AgentDriveError",
    "AgentDriveService",
    "DriveCommitItem",
    "DriveFileRef",
    "DriveSkillMetadata",
    "decode_drive_mention_ref",
    "normalize_drive_key",
    "parse_agent_drive_ref",
]
