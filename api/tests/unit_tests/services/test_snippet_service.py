from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.errors.app import WorkflowNotFoundError
from services.snippet_service import SnippetService


def _create_workflow(*, workflow_id: str, version: str, graph: dict, features: dict) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="snippet-1",
        type=WorkflowType.WORKFLOW.value,
        kind=WorkflowKind.SNIPPET.value,
        version=version,
        graph=json.dumps(graph),
        features=json.dumps(features),
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def test_restore_published_snippet_workflow_to_draft_copies_source_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    account = SimpleNamespace(id="account-2")
    source_graph = {"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []}
    source_features = {"opening_statement": "hello"}
    source_workflow = _create_workflow(
        workflow_id="published-workflow",
        version="2026-04-28 00:00:00",
        graph=source_graph,
        features=source_features,
    )
    draft_workflow = _create_workflow(
        workflow_id="draft-workflow",
        version=Workflow.VERSION_DRAFT,
        graph={"nodes": [], "edges": []},
        features={},
    )
    service = SnippetService.__new__(SnippetService)
    session = SimpleNamespace(add=Mock(), commit=Mock())

    monkeypatch.setattr(service, "get_published_workflow_by_id", Mock(return_value=source_workflow))
    monkeypatch.setattr(service, "get_draft_workflow", Mock(return_value=draft_workflow))
    monkeypatch.setattr("services.snippet_service.db.session", session)

    result = service.restore_published_workflow_to_draft(
        snippet=snippet,
        workflow_id=source_workflow.id,
        account=account,
    )

    assert result is draft_workflow
    assert draft_workflow.graph_dict == source_graph
    assert draft_workflow.features_dict == source_features
    assert draft_workflow.updated_by == account.id
    session.add.assert_not_called()
    session.commit.assert_called_once()


def test_restore_published_snippet_workflow_to_draft_raises_when_source_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1")
    account = SimpleNamespace(id="account-2")
    service = SnippetService.__new__(SnippetService)

    monkeypatch.setattr(service, "get_published_workflow_by_id", Mock(return_value=None))

    with pytest.raises(WorkflowNotFoundError):
        service.restore_published_workflow_to_draft(
            snippet=snippet,
            workflow_id="missing-workflow",
            account=account,
        )
