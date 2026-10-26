from __future__ import annotations

import json
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
    session_maker = Mock(spec=sessionmaker)
    monkeypatch.setattr(
        "services.knowledge_fs.runtime.get_knowledge_fs_runtime",
        lambda actual_session_maker: _Runtime(bindings) if actual_session_maker is session_maker else None,
    )
    return session_maker


def test_sync_workflow_bindings_unions_direct_and_frozen_agent_spaces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    flush = Mock()
    session = Mock(spec=Session, flush=flush)
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
        session=session,
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
    session = Mock(spec=Session)
    session.scalar.return_value = "existing-join"
    bindings = _RecordingAppBindings()
    session_maker = _patch_runtime(monkeypatch, bindings)

    knowledge_spaces.sync_workflow_app_knowledge_bindings(
        session=session,
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
    session = Mock(spec=Session)
    session.scalar.return_value = None
    session_maker = Mock(spec=sessionmaker)
    monkeypatch.setattr(
        "services.knowledge_fs.runtime.get_knowledge_fs_runtime",
        Mock(side_effect=AssertionError("runtime must not be constructed for a no-op")),
    )

    knowledge_spaces.sync_workflow_app_knowledge_bindings(
        session=session,
        session_maker=session_maker,
        workflow=_workflow([]),
    )

    session.scalar.assert_called_once()
