"""Published snippets must use a current draft without forbidden nodes."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowKind
from repositories.workflow.definition_repository import workflow_snapshot
from repositories.workflow.snippet_publication_repository import SnippetPublicationRepository
from services.workflow.contracts import WorkflowSnapshot
from tests.helpers.unit.model_factories import make_workflow


def _graph(node_type: str | None) -> dict[str, object]:
    nodes: list[dict[str, object]] = [] if node_type is None else [{"id": "node-1", "data": {"type": node_type}}]
    return {"nodes": nodes, "edges": []}


def _seed(sessions: sessionmaker[Session], node_type: str | None) -> WorkflowSnapshot:
    with sessions.begin() as session:
        snippet = CustomizedSnippet(
            id="snippet-1",
            tenant_id="tenant-1",
            name="Snippet",
            description="",
            type=SnippetType.NODE,
            created_by="account-1",
        )
        draft = make_workflow(
            workflow_id="draft-1", app_id=snippet.id, kind=WorkflowKind.SNIPPET, graph=_graph(node_type)
        )
        session.add_all([snippet, draft])
        session.flush()
        return workflow_snapshot(draft)


@pytest.mark.parametrize("node_type", ["start", "human-input", "knowledge-retrieval"])
def test_publication_rejects_forbidden_nodes_without_creating_version(
    sqlite_session_factory: sessionmaker[Session], node_type: str
) -> None:
    source = _seed(sqlite_session_factory, node_type)
    repository = SnippetPublicationRepository(sqlite_session_factory)

    with pytest.raises(ValueError, match=f"node-1:{node_type}"):
        with repository.publication(source):
            pytest.fail("Invalid Snippet must not enter the publication transaction")

    with sqlite_session_factory() as session:
        snippet = session.get(CustomizedSnippet, "snippet-1")
        assert snippet is not None
        assert not snippet.is_published
        assert snippet.workflow_id is None
        assert list(session.scalars(select(Workflow.id))) == ["draft-1"]


def test_publication_accepts_valid_snippet_graph(sqlite_session_factory: sessionmaker[Session]) -> None:
    source = _seed(sqlite_session_factory, None)
    repository = SnippetPublicationRepository(sqlite_session_factory)

    with repository.publication(source) as transaction:
        published = transaction.create_version(account_id="account-1")
        transaction.activate(published, account_id="account-1")

    with sqlite_session_factory() as session:
        snippet = session.get(CustomizedSnippet, "snippet-1")
        version = session.get(Workflow, published.id)
        assert snippet is not None
        assert version is not None
        assert snippet.is_published
        assert snippet.workflow_id == published.id
        assert version.kind == WorkflowKind.SNIPPET
