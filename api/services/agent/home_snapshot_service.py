"""Publish and retire config-version-owned immutable Agent Home snapshots.

Creation belongs to Agent config publication, before the new snapshot can be
committed as runnable. Runtime code may only consume the persisted ref. Dify
Agent remains a stateless infrastructure facade: the Dify API database owns the
mapping from ``AgentConfigSnapshot`` to backend snapshot ref.
"""

from __future__ import annotations

import base64
import hashlib
import json

from dify_agent.client import Client
from dify_agent.protocol import CreateHomeSnapshotRequest, HomeSnapshotSourceFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_storage import storage
from models.agent import AgentConfigDraft, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from models.model import UploadFile
from models.tools import ToolFile

_HOME_MANIFEST_PATH = ".dify/agent-home.json"


class AgentHomeSnapshotUnavailableError(RuntimeError):
    """A published config snapshot has no immutable Home binding."""


class AgentHomeSnapshotSourceError(RuntimeError):
    """A referenced config asset cannot be materialized into Agent Home."""


class AgentHomeSnapshotService:
    """Own Home Snapshot refs at config publication and Agent retirement."""

    @classmethod
    def materialize(cls, *, session: Session, snapshot: AgentConfigSnapshot) -> str:
        """Create and bind Home before ``snapshot`` becomes runnable.

        The caller owns the database transaction. The selected Dify Agent
        backend must create the ref because Local, Enterprise, and E2B refs are
        intentionally different native resource identifiers.
        """
        if snapshot.home_snapshot_ref:
            return snapshot.home_snapshot_ref

        base_url = dify_config.AGENT_BACKEND_BASE_URL
        if not base_url:
            raise AgentHomeSnapshotUnavailableError(
                "Dify Agent backend is required to materialize an immutable Home Snapshot."
            )

        source_files = cls._build_source_files(session=session, snapshot=snapshot)
        with Client(base_url=base_url) as client:
            response = client.create_home_snapshot_sync(
                CreateHomeSnapshotRequest(
                    tenant_id=snapshot.tenant_id,
                    agent_id=snapshot.agent_id,
                    agent_config_version_id=snapshot.id,
                    source_digest=cls._source_digest(source_files),
                    files=[
                        HomeSnapshotSourceFile(
                            path=path,
                            content_base64=base64.b64encode(content).decode("ascii"),
                        )
                        for path, content in source_files
                    ],
                )
            )
        snapshot.home_snapshot_ref = response.snapshot_ref
        return response.snapshot_ref

    @staticmethod
    def require_ref(snapshot: AgentConfigSnapshot) -> str:
        """Return a published Home ref without performing I/O or mutation."""
        if snapshot.home_snapshot_ref:
            return snapshot.home_snapshot_ref
        raise AgentHomeSnapshotUnavailableError(
            f"Agent config snapshot {snapshot.id} must materialize Home before runtime."
        )

    @classmethod
    def resolve_runtime_ref(
        cls,
        *,
        session: Session,
        config_version: AgentConfigSnapshot | AgentConfigDraft,
    ) -> str:
        """Resolve a published or editable config to a backend-native Home ref.

        Drafts do not own mutable Home resources. Both the shared draft and an
        account build draft run against the immutable snapshot named by
        ``base_snapshot_id``.
        """
        if isinstance(config_version, AgentConfigSnapshot):
            return cls.require_ref(config_version)
        if not config_version.base_snapshot_id:
            raise AgentHomeSnapshotUnavailableError(
                f"Agent config draft {config_version.id} has no base snapshot for runtime Home."
            )
        base_snapshot = session.scalar(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.id == config_version.base_snapshot_id,
                AgentConfigSnapshot.tenant_id == config_version.tenant_id,
                AgentConfigSnapshot.agent_id == config_version.agent_id,
            )
        )
        if base_snapshot is None:
            raise AgentHomeSnapshotUnavailableError(
                f"Agent config draft {config_version.id} base snapshot is unavailable."
            )
        return cls.require_ref(base_snapshot)

    @classmethod
    def delete_agent_snapshots(cls, *, session: Session, tenant_id: str, agent_id: str) -> None:
        """Best-effort delete all Home resources owned by an Agent and clear refs.

        Backend deletion is idempotent. Refs remain available for manual
        cleanup if an explicit delete attempt fails.
        """
        snapshots = session.scalars(
            select(AgentConfigSnapshot).where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.home_snapshot_ref.is_not(None),
            )
        ).all()
        refs = list(dict.fromkeys(snapshot.home_snapshot_ref for snapshot in snapshots if snapshot.home_snapshot_ref))
        for snapshot_ref in refs:
            cls.delete(snapshot_ref=snapshot_ref)
        for snapshot in snapshots:
            snapshot.home_snapshot_ref = None

    @classmethod
    def delete(cls, *, snapshot_ref: str) -> None:
        """Delete one deployment-owned snapshot ref; backend not-found is idempotent."""
        base_url = dify_config.AGENT_BACKEND_BASE_URL
        if not base_url:
            raise AgentHomeSnapshotUnavailableError("Dify Agent backend is required to delete a Home Snapshot.")
        with Client(base_url=base_url) as client:
            client.delete_home_snapshot_sync(snapshot_ref)

    @classmethod
    def _build_source_files(
        cls,
        *,
        session: Session,
        snapshot: AgentConfigSnapshot,
    ) -> list[tuple[str, bytes]]:
        """Build deterministic Home content without serializing runtime secrets."""
        soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        source_files: list[tuple[str, bytes]] = []
        assets: list[dict[str, object]] = []

        for file_ref in soul.config_files:
            if file_ref.is_missing:
                continue
            payload = cls._load_config_file(
                session=session,
                tenant_id=snapshot.tenant_id,
                file_kind=file_ref.file_kind,
                file_id=file_ref.file_id,
            )
            path = f".dify/config/files/{file_ref.name}"
            source_files.append((path, payload))
            assets.append(cls._asset_manifest(kind="file", name=file_ref.name, path=path, content=payload))

        for skill_ref in soul.config_skills:
            if skill_ref.is_missing:
                continue
            tool_file = session.scalar(
                select(ToolFile).where(
                    ToolFile.id == skill_ref.file_id,
                    ToolFile.tenant_id == snapshot.tenant_id,
                )
            )
            if tool_file is None:
                raise AgentHomeSnapshotSourceError(f"Config skill payload {skill_ref.name!r} is missing.")
            payload = storage.load_once(tool_file.file_key)
            path = f".dify/config/skills/{skill_ref.name}.zip"
            source_files.append((path, payload))
            assets.append(cls._asset_manifest(kind="skill", name=skill_ref.name, path=path, content=payload))

        manifest = {
            "schema_version": 1,
            "agent_id": snapshot.agent_id,
            "agent_config_version_id": snapshot.id,
            "config_note": soul.config_note,
            "assets": assets,
        }
        manifest_bytes = json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return sorted([(_HOME_MANIFEST_PATH, manifest_bytes), *source_files])

    @staticmethod
    def _load_config_file(
        *,
        session: Session,
        tenant_id: str,
        file_kind: str,
        file_id: str,
    ) -> bytes:
        if file_kind == "tool_file":
            tool_file = session.scalar(select(ToolFile).where(ToolFile.id == file_id, ToolFile.tenant_id == tenant_id))
            if tool_file is None:
                raise AgentHomeSnapshotSourceError(f"Config file payload {file_id!r} is missing.")
            return storage.load_once(tool_file.file_key)
        upload_file = session.scalar(
            select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id)
        )
        if upload_file is None:
            raise AgentHomeSnapshotSourceError(f"Config file payload {file_id!r} is missing.")
        return storage.load_once(upload_file.key)

    @staticmethod
    def _asset_manifest(*, kind: str, name: str, path: str, content: bytes) -> dict[str, object]:
        return {
            "kind": kind,
            "name": name,
            "path": path,
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }

    @staticmethod
    def _source_digest(files: list[tuple[str, bytes]]) -> str:
        digest = hashlib.sha256()
        for path, content in files:
            digest.update(path.encode("utf-8"))
            digest.update(b"\0")
            digest.update(hashlib.sha256(content).digest())
        return digest.hexdigest()


__all__ = [
    "AgentHomeSnapshotService",
    "AgentHomeSnapshotSourceError",
    "AgentHomeSnapshotUnavailableError",
]
