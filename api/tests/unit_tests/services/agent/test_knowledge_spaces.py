from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import Workflow
from services.agent import knowledge_spaces


@dataclass
class _RecordingAppBindings:
    calls: list[dict[str, object]] = field(default_factory=list)

    def sync_workflow_bindings(self, **kwargs: object) -> list[object]:
        self.calls.append(kwargs)
        return []


@dataclass
class _Runtime:
    app_bindings: _RecordingAppBindings


class _StubSessionMaker:
    pass


class _FakeSession:
    def __init__(self, *, scalar_value: object = None, on_flush: Callable[[], None] | None = None) -> None:
        self._scalar_value = scalar_value
        self._on_flush = on_flush
        self.scalar_called = 0

    def flush(self) -> None:
        if self._on_flush:
            self._on_flush()

    def scalar(self, *_args: object, **_kwargs: object) -> object:
        self.scalar_called += 1
        return self._scalar_value


def _workflow(nodes: list[dict[str, object]]) -> Workflow:
    return Workflow(
        id="published-workflow",
        tenant_id="tenant-1",
        app_id="app-1",
        version="2026-10-26T00:00:00Z",
        graph=json.dumps({"nodes": nodes, "edges": []}),
        created_by="account-1",
    )


def _patch_runtime(monkeypatch: pytest.MonkeyPatch, bindings: _RecordingAppBindings) -> sessionmaker[Session]:
    session_maker = _StubSessionMaker()
    monkeypatch.setattr(
        "services.knowledge_fs.runtime.get_knowledge_fs_runtime",
        lambda actual_session_maker: _Runtime(bindings) if actual_session_maker is session_maker else None,
    )
    return session_maker  # type: ignore[return-value]


def test_sync_workflow_bindings_unions_direct_and_frozen_agent_spaces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    flush = Mock()
    session = _FakeSession(on_flush=flush)
    bindings = _RecordingAppBindings()
    session_maker = _patch_runtime(monkeypatch, bindings)
    owning_session = session

    def collect_agent_spaces(*, session: Session, workflow: Workflow) -> tuple[str, ...]:
        assert session is owning_session
        assert flush.call_count == 1
        assert workflow.id == "published-workflow"
        return ("space-b", "space-c")

    monkeypatch.setattr(knowledge_spaces, "collect_workflow_agent_knowledge_space_ids", collect_agent_spaces)
    workflow = _workflow(
        [
            {
                "id": "knowledge",
                "data": {
                    "type": "knowledge-retrieval-v2",
                    "control_space_ids": ["space-a", "space-b"],
                    "query_variable_selector": ["start", "query"],
                },
            },
            {
                "id": "agent",
                "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"},
            },
        ]
    )

    knowledge_spaces.sync_workflow_app_knowledge_bindings(
        session=session,  # type: ignore[arg-type]
        session_maker=session_maker,
        workflow=workflow,
    )

    assert bindings.calls == [
        {
            "tenant_id": "tenant-1",
            "actor_account_id": "account-1",
            "app_id": "app-1",
            "control_space_ids": ["space-a", "space-b", "space-c"],
            "session": session,
        }
    ]


def test_sync_workflow_bindings_clears_stale_grants(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(scalar_value="existing-join")
    bindings = _RecordingAppBindings()
    session_maker = _patch_runtime(monkeypatch, bindings)

    knowledge_spaces.sync_workflow_app_knowledge_bindings(
        session=session,  # type: ignore[arg-type]
        session_maker=session_maker,
        workflow=_workflow([]),
    )

    assert bindings.calls == [
        {
            "tenant_id": "tenant-1",
            "actor_account_id": "account-1",
            "app_id": "app-1",
            "control_space_ids": [],
            "session": session,
        }
    ]


def test_sync_workflow_bindings_skips_empty_graph_without_stale_grants(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(scalar_value=None)
    session_maker = _StubSessionMaker()

    def _fail_get_runtime(_maker: object) -> None:
        raise AssertionError("runtime must not be constructed for a no-op")

    monkeypatch.setattr(
        "services.knowledge_fs.runtime.get_knowledge_fs_runtime",
        _fail_get_runtime,
    )

    knowledge_spaces.sync_workflow_app_knowledge_bindings(
        session=session,  # type: ignore[arg-type]
        session_maker=session_maker,  # type: ignore[arg-type]
        workflow=_workflow([]),
    )

    assert session.scalar_called == 1
