from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

from core.workflow.nodes.knowledge_retrieval_v2.validation import missing_control_space_ids
from events.event_handlers import sync_knowledge_fs_bindings_when_app_published_workflow_updated as handler


def _workflow(*space_groups: list[str]) -> SimpleNamespace:
    return SimpleNamespace(
        created_by="account-1",
        graph_dict={
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
        },
    )


def test_extracts_deduplicated_control_spaces_in_graph_order() -> None:
    workflow = _workflow(["space-a", "space-b"], ["space-b", "space-c"])

    assert handler.get_control_space_ids_from_workflow(workflow) == (
        "space-a",
        "space-b",
        "space-c",
    )


def test_missing_space_validation_preserves_requested_order() -> None:
    session = SimpleNamespace(scalars=lambda _statement: ["space-b"])
    workflow = _workflow(["space-a", "space-b", "space-c"])

    assert missing_control_space_ids(
        session=session,
        tenant_id="tenant-1",
        graph=workflow.graph_dict,
    ) == ("space-a", "space-c")


def test_publish_handler_exactly_syncs_workflow_bindings(monkeypatch) -> None:
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
