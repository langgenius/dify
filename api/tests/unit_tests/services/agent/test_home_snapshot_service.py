from __future__ import annotations

import base64
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from models.agent import AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from services.agent import home_snapshot_service as service_module
from services.agent.home_snapshot_service import AgentHomeSnapshotService, AgentHomeSnapshotUnavailableError


def _snapshot(*, home_snapshot_ref: str | None = None) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "config_note": "Remember the customer context.",
                "config_files": [
                    {
                        "name": "context.txt",
                        "file_kind": "upload_file",
                        "file_id": "upload-1",
                        "mime_type": "text/plain",
                    }
                ],
                "config_skills": [
                    {
                        "name": "research",
                        "file_id": "tool-1",
                    }
                ],
                "env": {
                    "secret_refs": [
                        {
                            "name": "API_TOKEN",
                            "value": "must-not-enter-home",
                        }
                    ]
                },
            }
        ),
        home_snapshot_ref=home_snapshot_ref,
    )


def test_materialize_creates_canonical_home_files_and_persists_ref(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = _snapshot()
    session = MagicMock()
    session.scalar.side_effect = [
        SimpleNamespace(id="upload-1", tenant_id="tenant-1", key="uploads/context", mime_type="text/plain"),
        SimpleNamespace(id="tool-1", tenant_id="tenant-1", file_key="tools/research", mimetype="application/zip"),
    ]
    client = MagicMock()
    client.__enter__.return_value = client
    client.create_home_snapshot_sync.return_value = SimpleNamespace(snapshot_ref="home-1")
    monkeypatch.setattr(service_module.dify_config, "AGENT_BACKEND_BASE_URL", "http://agent-backend")
    monkeypatch.setattr(service_module, "Client", lambda *, base_url: client)
    monkeypatch.setattr(
        service_module.storage,
        "load_once",
        lambda key: {"uploads/context": b"customer=Acme", "tools/research": b"PK\x03\x04skill"}[key],
    )

    result = AgentHomeSnapshotService.materialize(session=session, snapshot=snapshot)

    assert result == "home-1"
    assert snapshot.home_snapshot_ref == "home-1"
    request = client.create_home_snapshot_sync.call_args.args[0]
    files = {item.path: base64.b64decode(item.content_base64) for item in request.files}
    assert files[".dify/agent-home.json"]
    assert files[".dify/config/files/context.txt"] == b"customer=Acme"
    assert files[".dify/config/skills/research.zip"] == b"PK\x03\x04skill"
    manifest = json.loads(files[".dify/agent-home.json"])
    assert manifest["config_note"] == "Remember the customer context."
    assert "must-not-enter-home" not in files[".dify/agent-home.json"].decode()
    assert request.source_digest


def test_materialize_requires_the_deployment_home_snapshot_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = _snapshot()
    monkeypatch.setattr(service_module.dify_config, "AGENT_BACKEND_BASE_URL", None)

    with pytest.raises(AgentHomeSnapshotUnavailableError, match="backend"):
        AgentHomeSnapshotService.materialize(session=MagicMock(), snapshot=snapshot)

    assert snapshot.home_snapshot_ref is None


def test_require_ref_is_runtime_read_only() -> None:
    snapshot = _snapshot(home_snapshot_ref="home-1")

    assert AgentHomeSnapshotService.require_ref(snapshot) == "home-1"

    with pytest.raises(AgentHomeSnapshotUnavailableError, match="before runtime"):
        AgentHomeSnapshotService.require_ref(_snapshot())


def test_resolve_runtime_ref_uses_draft_base_snapshot_binding() -> None:
    base_snapshot = _snapshot(home_snapshot_ref="local-home-1")
    draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        draft_owner_key="",
        base_snapshot_id=base_snapshot.id,
        config_snapshot=AgentSoulConfig(),
    )
    session = MagicMock()
    session.scalar.return_value = base_snapshot

    assert AgentHomeSnapshotService.resolve_runtime_ref(session=session, config_version=draft) == "local-home-1"


def test_resolve_runtime_ref_rejects_draft_without_materialized_base_snapshot() -> None:
    draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        base_snapshot_id=None,
        config_snapshot=AgentSoulConfig(),
    )

    with pytest.raises(AgentHomeSnapshotUnavailableError, match="base snapshot"):
        AgentHomeSnapshotService.resolve_runtime_ref(session=MagicMock(), config_version=draft)


def test_delete_agent_snapshots_deletes_unique_refs_and_clears_bindings(monkeypatch: pytest.MonkeyPatch) -> None:
    first = _snapshot(home_snapshot_ref="home-1")
    second = _snapshot(home_snapshot_ref="home-1")
    third = _snapshot(home_snapshot_ref="home-2")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [first, second, third]
    deleted: list[str] = []
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", lambda *, snapshot_ref: deleted.append(snapshot_ref))

    AgentHomeSnapshotService.delete_agent_snapshots(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
    )

    assert deleted == ["home-1", "home-2"]
    assert first.home_snapshot_ref is None
    assert second.home_snapshot_ref is None
    assert third.home_snapshot_ref is None


def test_delete_agent_snapshots_failure_keeps_every_database_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    first = _snapshot(home_snapshot_ref="home-1")
    second = _snapshot(home_snapshot_ref="home-1")
    third = _snapshot(home_snapshot_ref="home-2")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [first, second, third]
    deleted: list[str] = []

    def delete(*, snapshot_ref: str) -> None:
        deleted.append(snapshot_ref)
        if snapshot_ref == "home-2":
            raise RuntimeError("backend delete failed")

    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    with pytest.raises(RuntimeError, match="backend delete failed"):
        AgentHomeSnapshotService.delete_agent_snapshots(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
        )

    assert deleted == ["home-1", "home-2"]
    assert first.home_snapshot_ref == "home-1"
    assert second.home_snapshot_ref == "home-1"
    assert third.home_snapshot_ref == "home-2"
    session.commit.assert_not_called()
