from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from core.workflow.nodes.knowledge_retrieval_v2.validation import missing_control_space_ids
from events.event_handlers import sync_knowledge_fs_bindings_when_app_published_workflow_updated as handler
from models.workflow import Workflow


def _workflow(*space_groups: list[str]) -> Workflow:
    return Workflow(
        created_by="account-1",
        graph=json.dumps(
            {
                "nodes": [
                    {
                        "data": {
                            "control_space_ids": spaces,
                            "query_variable_selector": ["start", "query"],
                            "title": "KnowledgeFS Retrieval",
                            "type": "knowledge-retrieval-v2",
                        }
                    }
                    for spaces in space_groups
                ]
            }
        ),
    )


def test_extracts_deduplicated_control_spaces_in_graph_order() -> None:
    workflow = _workflow(["space-a", "space-b"], ["space-b", "space-c"])

    assert handler.get_control_space_ids_from_workflow(workflow) == (
        "space-a",
        "space-b",
        "space-c",
    )


def test_missing_space_validation_preserves_requested_order() -> None:
    session = Mock(spec=Session)
    session.scalars.return_value = ["space-b"]
    workflow = _workflow(["space-a", "space-b", "space-c"])

    assert missing_control_space_ids(
        session=session,
        tenant_id="tenant-1",
        graph=workflow.graph_dict,
    ) == ("space-a", "space-c")


def test_publish_handler_exactly_syncs_workflow_bindings(monkeypatch: pytest.MonkeyPatch) -> None:
    sync = Mock()
    monkeypatch.setattr(
        handler,
        "get_knowledge_fs_runtime",
        lambda _session_maker: SimpleNamespace(app_bindings=SimpleNamespace(sync_workflow_bindings=sync)),
    )
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    workflow = _workflow(["space-a", "space-b"])
    publish_session = SimpleNamespace()

    handler.handle(app, published_workflow=workflow, session=publish_session)

    sync.assert_called_once_with(
        tenant_id="tenant-1",
        actor_account_id="account-1",
        app_id="app-1",
        control_space_ids=["space-a", "space-b"],
        session=publish_session,
    )


def test_publish_union_includes_modern_agent_and_uses_the_publish_transaction(monkeypatch: pytest.MonkeyPatch) -> None:
    sync = Mock()
    monkeypatch.setattr(
        handler,
        "get_knowledge_fs_runtime",
        lambda _: SimpleNamespace(app_bindings=SimpleNamespace(sync_workflow_bindings=sync)),
    )
    session = Mock()

    def frozen_spaces(**kwargs: object) -> tuple[str, ...]:
        session.flush.assert_called_once()
        assert kwargs["session"] is session
        return ("space-b", "space-c")

    monkeypatch.setattr(handler, "collect_workflow_agent_knowledge_space_ids", frozen_spaces)
    workflow = _workflow(["space-a", "space-b"])
    graph = workflow.graph_dict
    graph["nodes"].append({"data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}})
    workflow.graph = json.dumps(graph)
    handler.handle(SimpleNamespace(id="app-1", tenant_id="tenant-1"), published_workflow=workflow, session=session)
    assert sync.call_args.kwargs["control_space_ids"] == ["space-a", "space-b", "space-c"]
    assert sync.call_args.kwargs["session"] is session
