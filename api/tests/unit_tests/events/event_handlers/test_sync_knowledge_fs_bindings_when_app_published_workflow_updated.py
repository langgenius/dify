from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field

import pytest
from sqlalchemy.orm import Session

from core.workflow.nodes.knowledge_retrieval_v2.validation import missing_control_space_ids
from events.event_handlers import sync_knowledge_fs_bindings_when_app_published_workflow_updated as handler
from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from models.model import App
from models.workflow import Workflow


@dataclass
class _RecordingAppBindings:
    calls: list[dict[str, object]] = field(default_factory=list)

    def sync_workflow_bindings(self, **kwargs: object) -> list[object]:
        self.calls.append(kwargs)
        return []


@dataclass
class _Runtime:
    app_bindings: _RecordingAppBindings


class _FlushRecordingSession(Session):
    def __init__(self) -> None:
        super().__init__()
        self.flush_count = 0

    def flush(self, objects: Sequence[object] | None = None) -> None:
        self.flush_count += 1
        super().flush(objects)


def _app() -> App:
    return App(id="app-1", tenant_id="tenant-1")


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


def test_missing_space_validation_preserves_requested_order(sqlite_session: Session) -> None:
    active_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-b",
        knowledge_space_id="knowledge-space-b",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    active_space.id = "space-b"
    sqlite_session.add(active_space)
    sqlite_session.flush()
    workflow = _workflow(["space-a", "space-b", "space-c"])

    assert missing_control_space_ids(
        session=sqlite_session,
        tenant_id="tenant-1",
        graph=workflow.graph_dict,
    ) == ("space-a", "space-c")


def test_publish_handler_exactly_syncs_workflow_bindings(monkeypatch: pytest.MonkeyPatch) -> None:
    bindings = _RecordingAppBindings()
    monkeypatch.setattr(handler, "get_knowledge_fs_runtime", lambda _session_maker: _Runtime(bindings))
    workflow = _workflow(["space-a", "space-b"])
    publish_session = Session()

    handler.handle(_app(), published_workflow=workflow, session=publish_session)

    assert bindings.calls == [
        {
            "tenant_id": "tenant-1",
            "actor_account_id": "account-1",
            "app_id": "app-1",
            "control_space_ids": ["space-a", "space-b"],
            "session": publish_session,
        }
    ]


def test_publish_union_includes_modern_agent_and_uses_the_publish_transaction(monkeypatch: pytest.MonkeyPatch) -> None:
    bindings = _RecordingAppBindings()
    monkeypatch.setattr(handler, "get_knowledge_fs_runtime", lambda _: _Runtime(bindings))
    publish_session = _FlushRecordingSession()

    def frozen_spaces(**kwargs: object) -> tuple[str, ...]:
        assert publish_session.flush_count == 1
        assert kwargs["session"] is publish_session
        return ("space-b", "space-c")

    monkeypatch.setattr(handler, "collect_workflow_agent_knowledge_space_ids", frozen_spaces)
    workflow = _workflow(["space-a", "space-b"])
    graph = workflow.graph_dict
    graph["nodes"].append({"data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}})
    workflow.graph = json.dumps(graph)
    handler.handle(_app(), published_workflow=workflow, session=publish_session)
    assert len(bindings.calls) == 1
    assert bindings.calls[0]["control_space_ids"] == ["space-a", "space-b", "space-c"]
    assert bindings.calls[0]["session"] is publish_session
