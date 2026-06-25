from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDriveFile,
)
from models.agent_config_entities import AgentFileRefConfig, AgentSkillRefConfig, AgentSoulConfig
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent_drive_service import AgentDriveError, DriveSkillMetadata, normalize_drive_key

_SKILL_MD_SUFFIX = "/SKILL.md"
_SKILL_ARCHIVE_NAME = ".DIFY-SKILL-FULL.zip"
_FILES_PREFIX = "files/"


class AgentSoulFilesService:
    """Versioned Agent Soul view of drive-backed skills and files.

    ``agent_drive_files`` remains the storage/index for bytes and drive values.
    ``AgentSoulConfig.files`` records the versioned pointers that a specific
    Agent Soul snapshot owns, so restore/publish/runtime do not accidentally see
    later drive mutations.
    """

    @classmethod
    def sync_drive_commit_to_active_soul(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        committed_items: list[dict[str, Any]],
    ) -> AgentConfigSnapshot | None:
        if not committed_items:
            return None

        agent = db.session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id))
        if agent is None or not agent.active_config_snapshot_id:
            return None
        current_snapshot = db.session.scalar(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == agent.active_config_snapshot_id,
            )
        )
        if current_snapshot is None:
            return None

        agent_soul = AgentSoulConfig.model_validate(current_snapshot.config_snapshot_dict).model_copy(deep=True)
        before = agent_soul.files.model_dump(mode="json")
        for item in committed_items:
            cls._apply_commit_item(agent_soul=agent_soul, item=item)
        if agent_soul.files.model_dump(mode="json") == before:
            return None

        version = cls._create_config_version(
            tenant_id=tenant_id,
            agent_id=agent_id,
            account_id=account_id,
            agent_soul=agent_soul,
            previous_snapshot_id=current_snapshot.id,
        )
        agent.active_config_snapshot_id = version.id
        agent.active_config_has_model = agent_soul_has_model(agent_soul)
        agent.updated_by = account_id
        db.session.flush()
        return version

    @classmethod
    def list_files(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
        prefix: str = "",
    ) -> list[dict[str, Any]]:
        agent_soul = cls.active_agent_soul(session=session, tenant_id=tenant_id, agent_id=agent_id)
        file_keys = [file.drive_key for file in agent_soul.files.files if file.drive_key]
        if prefix:
            normalized_prefix = normalize_drive_key(prefix)
            file_keys = [key for key in file_keys if key.startswith(normalized_prefix)]
        if not file_keys:
            return []

        rows = cls._drive_rows_by_key(session=session, tenant_id=tenant_id, agent_id=agent_id, keys=file_keys)
        items: list[dict[str, Any]] = []
        for file_ref in agent_soul.files.files:
            key = file_ref.drive_key
            if not key or key not in file_keys:
                continue
            row = rows.get(key)
            item = cls._file_item_from_ref(file_ref)
            item.update(cls._row_item(row) if row is not None else {"key": key, "missing": True})
            items.append(item)
        return items

    @classmethod
    def list_manifest_items(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
        prefix: str = "",
    ) -> list[dict[str, Any]]:
        agent_soul = cls.active_agent_soul(session=session, tenant_id=tenant_id, agent_id=agent_id)
        refs = cls._all_file_refs(agent_soul)
        if prefix:
            normalized_prefix = normalize_drive_key(prefix)
            refs = [ref for ref in refs if (ref.drive_key or "").startswith(normalized_prefix)]
        keys = [ref.drive_key for ref in refs if ref.drive_key]
        rows = cls._drive_rows_by_key(session=session, tenant_id=tenant_id, agent_id=agent_id, keys=keys)

        items: list[dict[str, Any]] = []
        for file_ref in refs:
            key = file_ref.drive_key
            if not key:
                continue
            row = rows.get(key)
            item = cls._file_item_from_ref(file_ref)
            item.update(cls._row_item(row) if row is not None else {"key": key, "missing": True})
            item["file_id"] = file_ref.file_id or file_ref.upload_file_id
            items.append(item)
        return sorted(items, key=lambda item: str(item.get("key") or ""))

    @classmethod
    def list_skills(
        cls,
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
    ) -> list[dict[str, Any]]:
        agent_soul = cls.active_agent_soul(session=session, tenant_id=tenant_id, agent_id=agent_id)
        skill_keys = [skill.skill_md_key for skill in agent_soul.files.skills if skill.skill_md_key]
        archive_keys = [skill.full_archive_key for skill in agent_soul.files.skills if skill.full_archive_key]
        rows = cls._drive_rows_by_key(
            session=session, tenant_id=tenant_id, agent_id=agent_id, keys=[*skill_keys, *archive_keys]
        )
        items: list[dict[str, Any]] = []
        for skill in agent_soul.files.skills:
            if not skill.skill_md_key:
                continue
            row = rows.get(skill.skill_md_key)
            archive_key = skill.full_archive_key if skill.full_archive_key in rows else None
            skill_md_ref = cls.file_ref_for_key(agent_soul=agent_soul, key=skill.skill_md_key)
            items.append(
                {
                    "path": skill.path or cls.skill_path_from_key(skill.skill_md_key),
                    "skill_md_key": skill.skill_md_key,
                    "archive_key": archive_key or skill.full_archive_key,
                    "name": skill.name,
                    "description": skill.description,
                    "size": row.size if row is not None else None,
                    "mime_type": row.mime_type if row is not None else (skill_md_ref.type if skill_md_ref else None),
                    "hash": row.hash if row is not None else None,
                    "created_at": int(row.created_at.timestamp()) if row is not None and row.created_at else None,
                    "missing": row is None,
                }
            )
        return items

    @classmethod
    def allowed_drive_keys(cls, agent_soul: AgentSoulConfig) -> set[str]:
        keys: set[str] = set()
        for file_ref in agent_soul.files.files:
            if file_ref.drive_key:
                keys.add(file_ref.drive_key)
        for skill in agent_soul.files.skills:
            if skill.skill_md_key:
                keys.add(skill.skill_md_key)
            if skill.full_archive_key:
                keys.add(skill.full_archive_key)
            for file_ref in skill.file_refs:
                if file_ref.drive_key:
                    keys.add(file_ref.drive_key)
        return keys

    @classmethod
    def allowed_skill_prefixes(cls, agent_soul: AgentSoulConfig) -> set[str]:
        prefixes: set[str] = set()
        for skill in agent_soul.files.skills:
            path = skill.path or (cls.skill_path_from_key(skill.skill_md_key) if skill.skill_md_key else None)
            if path:
                prefixes.add(f"{path}/")
        return prefixes

    @classmethod
    def key_allowed_by_soul(cls, *, agent_soul: AgentSoulConfig, key: str) -> bool:
        normalized_key = normalize_drive_key(key)
        if normalized_key in cls.allowed_drive_keys(agent_soul):
            return True
        return any(normalized_key.startswith(prefix) for prefix in cls.allowed_skill_prefixes(agent_soul))

    @classmethod
    def file_ref_for_key(cls, *, agent_soul: AgentSoulConfig, key: str) -> AgentFileRefConfig | None:
        normalized_key = normalize_drive_key(key)
        for file_ref in agent_soul.files.files:
            if file_ref.drive_key == normalized_key:
                return file_ref
        for skill in agent_soul.files.skills:
            for file_ref in skill.file_refs:
                if file_ref.drive_key == normalized_key:
                    return file_ref
        return None

    @classmethod
    def drive_copy_scopes(cls, *, agent_soul: AgentSoulConfig) -> tuple[set[str], set[str]]:
        exact_keys = cls.allowed_drive_keys(agent_soul)
        prefixes = cls.allowed_skill_prefixes(agent_soul)
        return exact_keys, prefixes

    @staticmethod
    def active_agent_soul(*, session: Session, tenant_id: str, agent_id: str) -> AgentSoulConfig:
        snapshot = session.scalar(
            select(AgentConfigSnapshot)
            .join(Agent, Agent.active_config_snapshot_id == AgentConfigSnapshot.id)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
            )
        )
        if snapshot is None:
            raise AgentDriveError(
                "agent_snapshot_not_found",
                "agent has no active Agent Soul snapshot",
                status_code=404,
            )
        return AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)

    @staticmethod
    def skill_path_from_key(key: str) -> str:
        if not key.endswith(_SKILL_MD_SUFFIX):
            raise AgentDriveError(
                "invalid_skill_key",
                "skill rows must use the canonical '<path>/SKILL.md' key",
                status_code=500,
            )
        return key[: -len(_SKILL_MD_SUFFIX)]

    @staticmethod
    def skill_archive_key(skill_md_key: str) -> str:
        return f"{AgentSoulFilesService.skill_path_from_key(skill_md_key)}/{_SKILL_ARCHIVE_NAME}"

    @classmethod
    def _apply_commit_item(cls, *, agent_soul: AgentSoulConfig, item: dict[str, Any]) -> None:
        key = normalize_drive_key(str(item.get("key") or ""))
        if item.get("removed"):
            cls._remove_ref(agent_soul=agent_soul, key=key)
            return

        if item.get("is_skill"):
            cls._upsert_skill_ref(agent_soul=agent_soul, key=key, item=item)
            return
        if key.startswith(_FILES_PREFIX):
            cls._upsert_file_ref(agent_soul=agent_soul, key=key, item=item)
            return
        cls._upsert_skill_file_ref(agent_soul=agent_soul, key=key, item=item)

    @classmethod
    def _upsert_skill_ref(cls, *, agent_soul: AgentSoulConfig, key: str, item: dict[str, Any]) -> None:
        metadata = cls._parse_skill_metadata(item.get("skill_metadata"))
        path = cls.skill_path_from_key(key)
        ref = AgentSkillRefConfig(
            id=path,
            name=metadata.name,
            description=metadata.description,
            file_id=str(item.get("file_id") or ""),
            path=path,
            skill_md_key=key,
            skill_md_file_id=str(item.get("file_id") or ""),
            full_archive_key=cls.skill_archive_key(key),
            manifest_files=metadata.manifest_files,
        )
        existing_ref = next(
            (existing for existing in agent_soul.files.skills if existing.skill_md_key == key or existing.path == path),
            None,
        )
        file_refs = list(existing_ref.file_refs) if existing_ref else []
        file_refs = [file_ref for file_ref in file_refs if file_ref.drive_key != key]
        file_refs.append(cls._file_ref_from_item(key=key, item=item, name="SKILL.md"))
        archive_key = cls.skill_archive_key(key)
        archive_ref = next((file_ref for file_ref in file_refs if file_ref.drive_key == archive_key), None)
        if archive_ref:
            ref.full_archive_file_id = archive_ref.file_id
        ref.file_refs = sorted(file_refs, key=lambda value: value.drive_key or value.name)
        skills = [
            existing for existing in agent_soul.files.skills if existing.skill_md_key != key and existing.path != path
        ]
        skills.append(ref)
        skills.sort(key=lambda value: value.path or value.skill_md_key or "")
        agent_soul.files.skills = skills

    @staticmethod
    def _upsert_file_ref(*, agent_soul: AgentSoulConfig, key: str, item: dict[str, Any]) -> None:
        name = key.removeprefix(_FILES_PREFIX) or key.rsplit("/", 1)[-1]
        file_id = str(item.get("file_id") or "")
        ref = AgentFileRefConfig(
            id=key,
            file_id=file_id,
            upload_file_id=file_id if item.get("file_kind") == "upload_file" else None,
            name=name,
            type=str(item.get("mime_type") or ""),
            transfer_method=str(item.get("file_kind") or ""),
            drive_key=key,
            size=item.get("size"),
            hash=item.get("hash"),
        )
        files = [existing for existing in agent_soul.files.files if existing.drive_key != key]
        files.append(ref)
        files.sort(key=lambda value: value.drive_key or value.name)
        agent_soul.files.files = files

    @classmethod
    def _upsert_skill_file_ref(cls, *, agent_soul: AgentSoulConfig, key: str, item: dict[str, Any]) -> None:
        path = key.split("/", 1)[0]
        if not path:
            return
        updated: list[AgentSkillRefConfig] = []
        changed = False
        for skill in agent_soul.files.skills:
            skill_path = skill.path or (cls.skill_path_from_key(skill.skill_md_key) if skill.skill_md_key else "")
            if skill_path != path:
                updated.append(skill)
                continue
            file_ref = cls._file_ref_from_item(key=key, item=item)
            file_refs = [existing for existing in skill.file_refs if existing.drive_key != key]
            file_refs.append(file_ref)
            replacement = skill.model_copy(
                update={"file_refs": sorted(file_refs, key=lambda value: value.drive_key or value.name)}
            )
            if key.endswith(f"/{_SKILL_ARCHIVE_NAME}"):
                replacement = replacement.model_copy(
                    update={
                        "full_archive_key": key,
                        "full_archive_file_id": file_ref.file_id,
                    }
                )
            updated.append(replacement)
            changed = True
        if changed:
            agent_soul.files.skills = updated

    @staticmethod
    def _file_ref_from_item(*, key: str, item: dict[str, Any], name: str | None = None) -> AgentFileRefConfig:
        file_id = str(item.get("file_id") or "")
        return AgentFileRefConfig(
            id=key,
            file_id=file_id,
            upload_file_id=file_id if item.get("file_kind") == "upload_file" else None,
            name=name or key.rsplit("/", 1)[-1],
            type=str(item.get("mime_type") or ""),
            transfer_method=str(item.get("file_kind") or ""),
            drive_key=key,
            size=item.get("size"),
            hash=item.get("hash"),
        )

    @classmethod
    def _remove_ref(cls, *, agent_soul: AgentSoulConfig, key: str) -> None:
        agent_soul.files.files = [file_ref for file_ref in agent_soul.files.files if file_ref.drive_key != key]
        if key.endswith(_SKILL_MD_SUFFIX):
            path = cls.skill_path_from_key(key)
            agent_soul.files.skills = [
                skill for skill in agent_soul.files.skills if skill.skill_md_key != key and skill.path != path
            ]
            return
        if key.endswith(f"/{_SKILL_ARCHIVE_NAME}"):
            agent_soul.files.skills = [
                skill.model_copy(
                    update={
                        "full_archive_key": None,
                        "full_archive_file_id": None,
                        "file_refs": [file_ref for file_ref in skill.file_refs if file_ref.drive_key != key],
                    }
                )
                if skill.full_archive_key == key
                else skill
                for skill in agent_soul.files.skills
            ]
            return
        path = key.split("/", 1)[0]
        if path:
            agent_soul.files.skills = [
                skill.model_copy(
                    update={"file_refs": [file_ref for file_ref in skill.file_refs if file_ref.drive_key != key]}
                )
                if (skill.path or (cls.skill_path_from_key(skill.skill_md_key) if skill.skill_md_key else "")) == path
                else skill
                for skill in agent_soul.files.skills
            ]

    @staticmethod
    def _all_file_refs(agent_soul: AgentSoulConfig) -> list[AgentFileRefConfig]:
        refs = list(agent_soul.files.files)
        for skill in agent_soul.files.skills:
            refs.extend(skill.file_refs)
        return refs

    @staticmethod
    def _parse_skill_metadata(raw_metadata: Any) -> DriveSkillMetadata:
        if isinstance(raw_metadata, DriveSkillMetadata):
            return raw_metadata
        if isinstance(raw_metadata, str):
            return DriveSkillMetadata.model_validate(json.loads(raw_metadata))
        return DriveSkillMetadata.model_validate(raw_metadata or {})

    @staticmethod
    def _drive_rows_by_key(
        *,
        session: Session,
        tenant_id: str,
        agent_id: str,
        keys: list[str],
    ) -> dict[str, AgentDriveFile]:
        if not keys:
            return {}
        return {
            row.key: row
            for row in session.scalars(
                select(AgentDriveFile).where(
                    AgentDriveFile.tenant_id == tenant_id,
                    AgentDriveFile.agent_id == agent_id,
                    AgentDriveFile.key.in_(sorted(set(keys))),
                )
            )
        }

    @staticmethod
    def _row_item(row: AgentDriveFile | None) -> dict[str, Any]:
        if row is None:
            return {}
        return {
            "key": row.key,
            "size": row.size,
            "hash": row.hash,
            "mime_type": row.mime_type,
            "file_kind": row.file_kind.value,
            "is_skill": row.is_skill,
            "skill_metadata": row.skill_metadata,
            "created_at": int(row.created_at.timestamp()) if row.created_at else None,
        }

    @staticmethod
    def _file_item_from_ref(file_ref: AgentFileRefConfig) -> dict[str, Any]:
        key = file_ref.drive_key or file_ref.name
        return {
            "key": key,
            "name": file_ref.name,
            "mime_type": file_ref.type,
            "file_kind": file_ref.transfer_method,
            "is_skill": False,
            "size": file_ref.get("size"),
            "hash": file_ref.get("hash"),
        }

    @classmethod
    def _create_config_version(
        cls,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        agent_soul: AgentSoulConfig,
        previous_snapshot_id: str,
    ) -> AgentConfigSnapshot:
        next_version = (
            db.session.scalar(
                select(func.max(AgentConfigSnapshot.version)).where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent_id,
                )
            )
            or 0
        ) + 1
        version = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            version=next_version,
            config_snapshot=agent_soul,
            created_by=account_id,
        )
        db.session.add(version)
        db.session.flush()
        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent_id,
            previous_snapshot_id=previous_snapshot_id,
            current_snapshot_id=version.id,
            revision=cls._next_revision(tenant_id=tenant_id, agent_id=agent_id),
            operation=AgentConfigRevisionOperation.SAVE_CURRENT_VERSION,
            created_by=account_id,
        )
        db.session.add(revision)
        db.session.flush()
        return version

    @staticmethod
    def _next_revision(*, tenant_id: str, agent_id: str) -> int:
        return (
            db.session.scalar(
                select(func.max(AgentConfigRevision.revision)).where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                )
            )
            or 0
        ) + 1
