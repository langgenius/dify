from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.client import DifyAgentNotFoundError
from dify_agent.protocol import RuntimeLayerSpec, SandboxLocator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentKind,
    AgentRuntimeSession,
    AgentRuntimeSessionOwnerType,
    AgentRuntimeSessionStatus,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent import home_snapshot_service as service_module
from services.agent.composer_service import AgentComposerService
from services.agent.errors import AgentBuildSandboxNotFoundError
from services.agent.home_snapshot_service import (
    AgentHomeSnapshotService,
    AgentHomeSnapshotSourceError,
    AgentHomeSnapshotUnavailableError,
    require_runtime_home_snapshot_ref,
)


def _client(*, snapshot_ref: str = "backend-home-1") -> MagicMock:
    client = MagicMock()
    client.__enter__.return_value = client
    client.initialize_home_snapshot_sync.return_value = SimpleNamespace(snapshot_ref=snapshot_ref)
    client.create_home_snapshot_from_sandbox_sync.return_value = SimpleNamespace(snapshot_ref=snapshot_ref)
    return client


def _agent(*, status: AgentStatus = AgentStatus.ACTIVE) -> Agent:
    return Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="agent",
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        status=status,
    )


def _build_draft() -> AgentConfigDraft:
    return AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )


def _sandbox_locator() -> SandboxLocator:
    return SandboxLocator.model_validate(
        {
            "composition": {
                "schema_version": 1,
                "layers": [
                    {
                        "name": "execution_context",
                        "type": "dify.execution_context",
                        "config": {
                            "tenant_id": "tenant-1",
                            "user_from": "account",
                            "agent_mode": "agent_app",
                            "invoke_from": "debugger",
                        },
                    },
                    {
                        "name": "shell",
                        "type": "dify.shell",
                        "deps": {"execution_context": "execution_context"},
                        "config": {},
                    },
                ],
            },
            "session_snapshot": {
                "layers": [
                    {"name": "execution_context", "lifecycle_state": "suspended", "runtime_state": {}},
                    {
                        "name": "shell",
                        "lifecycle_state": "suspended",
                        "runtime_state": {"session_id": "session-1", "workspace_cwd": "/workspace"},
                    },
                ]
            },
        }
    )


def _retained_runtime_layer_specs() -> list[RuntimeLayerSpec]:
    return [
        RuntimeLayerSpec(name="execution_context", type="dify.execution_context", config={"tenant_id": "tenant-1"}),
        RuntimeLayerSpec(
            name="home",
            type="dify.home",
            deps={"execution_context": "execution_context"},
            config={"snapshot_ref": "backend-home-old"},
        ),
        RuntimeLayerSpec(
            name="workspace",
            type="dify.workspace",
            deps={"execution_context": "execution_context"},
            config={"workspace_id": "runtime-valid"},
        ),
        RuntimeLayerSpec(
            name="sandbox",
            type="dify.sandbox",
            deps={"execution_context": "execution_context", "home": "home", "workspace": "workspace"},
            config={},
        ),
    ]


def _retained_session_snapshot(*, handle: str) -> CompositorSessionSnapshot:
    return CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(
                name="execution_context",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={},
            ),
            LayerSessionSnapshot(name="home", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            LayerSessionSnapshot(name="workspace", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
            LayerSessionSnapshot(
                name="sandbox",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={"handle": handle},
            ),
        ]
    )


def _retained_runtime_row(
    *,
    row_id: str,
    conversation_id: str,
    draft_id: str = "build-1",
    home_snapshot_id: str = "home-old",
    status: AgentRuntimeSessionStatus = AgentRuntimeSessionStatus.ACTIVE,
    composition_layer_specs: str | None = None,
    handle: str | None = None,
    updated_at: datetime | None = None,
) -> AgentRuntimeSession:
    return AgentRuntimeSession(
        id=row_id,
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentRuntimeSessionOwnerType.CONVERSATION,
        agent_id="agent-1",
        home_snapshot_id=home_snapshot_id,
        backend_run_id=f"run-{row_id}",
        session_snapshot=_retained_session_snapshot(handle=handle or row_id).model_dump_json(),
        agent_config_snapshot_id=draft_id,
        composition_layer_specs=composition_layer_specs
        or json.dumps([spec.model_dump(mode="json") for spec in _retained_runtime_layer_specs()]),
        conversation_id=conversation_id,
        status=status,
        updated_at=updated_at or datetime(2026, 7, 22, 12, 0, 0),
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentConfigDraft, AgentDebugConversation, AgentRuntimeSession)],
    indirect=True,
)
def test_build_sandbox_selector_uses_exact_account_draft_home_and_active_runtime(
    sqlite_session: Session,
) -> None:
    build_draft = _build_draft()
    sqlite_session.add(build_draft)
    sqlite_session.add_all(
        [
            AgentDebugConversation(
                id="debug-wrong-account",
                tenant_id="tenant-1",
                agent_id="agent-1",
                app_id="app-1",
                account_id="account-other",
                conversation_id="conversation-wrong-account",
            ),
            AgentDebugConversation(
                id="debug-correct-account",
                tenant_id="tenant-1",
                agent_id="agent-1",
                app_id="app-1",
                account_id="account-1",
                conversation_id="conversation-correct-account",
            ),
            _retained_runtime_row(
                row_id="runtime-wrong-account",
                conversation_id="conversation-wrong-account",
                updated_at=datetime(2026, 7, 22, 12, 5, 0),
            ),
            _retained_runtime_row(
                row_id="runtime-wrong-draft",
                conversation_id="conversation-correct-account",
                draft_id="build-other",
                updated_at=datetime(2026, 7, 22, 12, 4, 0),
            ),
            _retained_runtime_row(
                row_id="runtime-wrong-home",
                conversation_id="conversation-correct-account",
                home_snapshot_id="home-other",
                updated_at=datetime(2026, 7, 22, 12, 3, 0),
            ),
            _retained_runtime_row(
                row_id="runtime-cleaned",
                conversation_id="conversation-correct-account",
                draft_id="build-cleaned",
                status=AgentRuntimeSessionStatus.CLEANED,
                updated_at=datetime(2026, 7, 22, 12, 2, 0),
            ),
            _retained_runtime_row(
                row_id="runtime-valid",
                conversation_id="conversation-correct-account",
                handle="sandbox-valid",
                updated_at=datetime(2026, 7, 22, 12, 1, 0),
            ),
        ]
    )
    sqlite_session.commit()

    locator = AgentComposerService._require_build_sandbox_locator(
        session=sqlite_session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        account_id="account-1",
        build_draft=build_draft,
    )

    assert [layer.name for layer in locator.composition.layers] == [
        "execution_context",
        "home",
        "workspace",
        "sandbox",
    ]
    assert locator.session_snapshot.layers[-1].runtime_state == {"handle": "sandbox-valid"}


@pytest.mark.parametrize(
    "composition_layer_specs",
    [
        "not-json",
        json.dumps(
            [
                RuntimeLayerSpec(
                    name="execution_context",
                    type="dify.execution_context",
                    config={"tenant_id": "tenant-1"},
                ).model_dump(mode="json")
            ]
        ),
    ],
    ids=["malformed-json", "unrecoverable-layer-set"],
)
@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentConfigDraft, AgentDebugConversation, AgentRuntimeSession)],
    indirect=True,
)
def test_build_sandbox_selector_fails_fast_for_unrecoverable_retained_row(
    sqlite_session: Session,
    composition_layer_specs: str,
) -> None:
    build_draft = _build_draft()
    sqlite_session.add_all(
        [
            build_draft,
            AgentDebugConversation(
                id="debug-correct-account",
                tenant_id="tenant-1",
                agent_id="agent-1",
                app_id="app-1",
                account_id="account-1",
                conversation_id="conversation-correct-account",
            ),
            _retained_runtime_row(
                row_id="runtime-unrecoverable",
                conversation_id="conversation-correct-account",
                composition_layer_specs=composition_layer_specs,
            ),
        ]
    )
    sqlite_session.commit()

    with pytest.raises(AgentHomeSnapshotSourceError, match="not recoverable"):
        AgentComposerService._require_build_sandbox_locator(
            session=sqlite_session,
            tenant_id="tenant-1",
            agent_id="agent-1",
            account_id="account-1",
            build_draft=build_draft,
        )


def test_create_initial_records_backend_ref_in_append_only_ledger(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    client = _client()
    monkeypatch.setattr(service_module, "uuidv7", lambda: "home-1")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", staticmethod(lambda: client))
    monkeypatch.setattr(AgentHomeSnapshotService, "_register_initial_compensation", lambda **_kwargs: None)

    snapshot = AgentHomeSnapshotService.create_initial(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
    )

    assert snapshot.id == "home-1"
    assert snapshot.snapshot_ref == "backend-home-1"
    request = client.initialize_home_snapshot_sync.call_args.args[0]
    assert request.model_dump() == {
        "tenant_id": "tenant-1",
        "agent_id": "agent-1",
        "home_snapshot_id": "home-1",
    }
    session.add.assert_called_once_with(snapshot)
    session.flush.assert_called_once_with()


def test_build_apply_records_snapshot_of_exact_retained_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    client = _client(snapshot_ref="backend-home-2")
    locator = _sandbox_locator()
    monkeypatch.setattr(service_module, "uuidv7", lambda: "home-2")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", staticmethod(lambda: client))

    snapshot = AgentHomeSnapshotService.create_for_build_apply(
        session=session,
        build_draft=_build_draft(),
        source_sandbox=locator,
    )

    assert snapshot.id == "home-2"
    assert snapshot.snapshot_ref == "backend-home-2"
    request = client.create_home_snapshot_from_sandbox_sync.call_args.args[0]
    assert request.home_snapshot_id == "home-2"
    assert request.source_sandbox is locator


def test_db_failure_compensates_new_backend_resource(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.flush.side_effect = RuntimeError("db failed")
    client = _client()
    deleted: list[str] = []
    monkeypatch.setattr(service_module, "uuidv7", lambda: "home-1")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", staticmethod(lambda: client))
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", lambda *, snapshot_ref: deleted.append(snapshot_ref))

    with pytest.raises(RuntimeError, match="db failed"):
        AgentHomeSnapshotService.create_initial(session=session, tenant_id="tenant-1", agent_id="agent-1")

    assert deleted == ["backend-home-1"]


def test_outer_transaction_rollback_compensates_initialized_home(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_engine("sqlite://")
    AgentHomeSnapshot.__table__.create(engine)
    client = _client()
    monkeypatch.setattr(
        service_module,
        "uuidv7",
        lambda: "00000000-0000-0000-0000-000000000001",
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", staticmethod(lambda: client))

    with Session(engine) as session:
        AgentHomeSnapshotService.create_initial(session=session, tenant_id="tenant-1", agent_id="agent-1")
        session.rollback()

    client.delete_home_snapshot_sync.assert_called_once_with("backend-home-1")


def test_build_apply_maps_missing_source_sandbox_to_stable_domain_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client()
    client.create_home_snapshot_from_sandbox_sync.side_effect = DifyAgentNotFoundError(
        404,
        {"code": "sandbox_not_found"},
    )
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", staticmethod(lambda: client))

    with pytest.raises(AgentBuildSandboxNotFoundError) as exc_info:
        AgentHomeSnapshotService.create_for_build_apply(
            session=MagicMock(),
            build_draft=_build_draft(),
            source_sandbox=_sandbox_locator(),
        )

    assert exc_info.value.error_code == "agent_build_sandbox_not_found"
    assert exc_info.value.code == 404


def test_delete_all_for_agent_uses_ledger_without_mutating_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    first = AgentHomeSnapshot(id="home-1", tenant_id="tenant-1", agent_id="agent-1", snapshot_ref="ref-1")
    second = AgentHomeSnapshot(id="home-2", tenant_id="tenant-1", agent_id="agent-1", snapshot_ref="ref-2")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [first, second]
    deleted: list[str] = []
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", lambda *, snapshot_ref: deleted.append(snapshot_ref))

    AgentHomeSnapshotService.delete_all_for_agent(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
    )

    assert set(deleted) == {"ref-1", "ref-2"}
    assert first.snapshot_ref == "ref-1"
    assert second.snapshot_ref == "ref-2"
    session.delete.assert_not_called()


def test_delete_failure_logs_owner_and_backend_ref(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    snapshot = AgentHomeSnapshot(id="home-1", tenant_id="tenant-1", agent_id="agent-1", snapshot_ref="ref-1")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [snapshot]
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "delete",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("delete failed")),
    )

    with caplog.at_level("ERROR", logger=service_module.__name__):
        with pytest.raises(RuntimeError, match="delete failed"):
            AgentHomeSnapshotService.delete_all_for_agent(
                session=session,
                tenant_id="tenant-1",
                agent_id="agent-1",
            )

    assert "tenant_id=tenant-1" in caplog.text
    assert "agent_id=agent-1" in caplog.text
    assert "home_snapshot_id=home-1" in caplog.text
    assert "snapshot_ref=ref-1" in caplog.text


def test_home_snapshot_ledger_schema() -> None:
    ledger = AgentHomeSnapshot.__table__

    assert ledger.name == "agent_home_snapshots"
    assert set(ledger.columns.keys()) == {
        "id",
        "tenant_id",
        "agent_id",
        "snapshot_ref",
        "created_at",
    }
    assert {column.name for column in ledger.primary_key.columns} == {"id"}
    assert {column.name for column in ledger.columns if not column.nullable} == {
        "id",
        "tenant_id",
        "agent_id",
        "snapshot_ref",
        "created_at",
    }
    owner_index = next(index for index in ledger.indexes if index.name == "agent_home_snapshot_tenant_agent_idx")
    assert [column.name for column in owner_index.columns] == ["tenant_id", "agent_id"]
    assert AgentConfigDraft.__table__.c.home_snapshot_id.nullable is False
    assert AgentConfigSnapshot.__table__.c.home_snapshot_id.nullable is False
    assert AgentRuntimeSession.__table__.c.home_snapshot_id.nullable is False
    conversation_index = next(
        index
        for index in AgentRuntimeSession.__table__.indexes
        if index.name == "agent_runtime_session_conversation_scope_unique"
    )
    assert [column.name for column in conversation_index.columns] == [
        "tenant_id",
        "conversation_id",
        "agent_id",
        "agent_config_snapshot_id",
        "home_snapshot_id",
    ]


@pytest.mark.parametrize("sqlite_session", [(AgentHomeSnapshot,)], indirect=True)
def test_runtime_resolution_requires_active_owner_scoped_ledger_row(sqlite_session: Session) -> None:
    sqlite_session.add(
        AgentHomeSnapshot(
            id="home-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            snapshot_ref="backend-home-1",
        )
    )
    sqlite_session.commit()

    assert (
        require_runtime_home_snapshot_ref(session=sqlite_session, agent=_agent(), home_snapshot_id="home-1")
        == "backend-home-1"
    )

    with pytest.raises(AgentHomeSnapshotUnavailableError, match="unavailable"):
        require_runtime_home_snapshot_ref(
            session=sqlite_session,
            agent=Agent(
                id="agent-1",
                tenant_id="tenant-other",
                name="cross-tenant",
                description="",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.ROSTER,
                status=AgentStatus.ACTIVE,
            ),
            home_snapshot_id="home-1",
        )

    with pytest.raises(AgentHomeSnapshotUnavailableError, match="unavailable"):
        require_runtime_home_snapshot_ref(
            session=sqlite_session,
            agent=Agent(
                id="agent-other",
                tenant_id="tenant-1",
                name="cross-agent",
                description="",
                agent_kind=AgentKind.DIFY_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.ROSTER,
                status=AgentStatus.ACTIVE,
            ),
            home_snapshot_id="home-1",
        )

    with pytest.raises(AgentHomeSnapshotUnavailableError, match="not active"):
        require_runtime_home_snapshot_ref(
            session=sqlite_session,
            agent=_agent(status=AgentStatus.ARCHIVED),
            home_snapshot_id="home-1",
        )


def test_home_operations_require_configured_dify_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module.dify_config, "AGENT_BACKEND_BASE_URL", None)

    with pytest.raises(AgentHomeSnapshotUnavailableError, match="required"):
        AgentHomeSnapshotService.create_initial(
            session=MagicMock(),
            tenant_id="tenant-1",
            agent_id="agent-1",
        )
