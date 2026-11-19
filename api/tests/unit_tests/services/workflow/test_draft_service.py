"""Snippet draft guards on the extracted workflow use case."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowKind
from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
from repositories.agent.workflow_binding_repository import WorkflowAgentBindingRepository
from repositories.workflow.draft_repository import WorkflowDraftRepository
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.errors.app import WorkflowHashNotEqualError
from services.workflow.contracts import (
    DraftImportResult,
    DraftSyncCommand,
    PreparedDraftSync,
    PreparedEnvironmentVariables,
    WorkflowOwner,
    WorkflowSnapshot,
)
from services.workflow.draft_service import WorkflowDraftService
from tests.helpers.unit.model_factories import make_workflow

CONTEXT = RequestContext("snippet-draft", None, "account-1", "tenant-1")
OWNER = WorkflowOwner("snippet-1", "snippet")
VALID_GRAPH: dict[str, object] = {"nodes": [], "edges": []}


class _SnippetLifecycle:
    """Read real draft state while exercising the service's policy boundary."""

    def __init__(self, definitions: WorkflowDraftRepository) -> None:
        self._definitions = definitions

    def prepare_sync(
        self,
        context: RequestContext,
        owner: WorkflowOwner,
        command: DraftSyncCommand,
        environment: PreparedEnvironmentVariables | None,
    ) -> PreparedDraftSync:
        source = self._definitions.snapshot(context, owner)
        if source is not None and command.unique_hash is not None and source.hash != command.unique_hash:
            raise WorkflowHashNotEqualError()
        return PreparedDraftSync(source, environment)

    def validate_restore(self, context: RequestContext, owner: WorkflowOwner, workflow_id: str) -> WorkflowSnapshot:
        source = self._definitions.snapshot(context, owner, workflow_id)
        assert source is not None
        return source

    def draft_synced(self, context: RequestContext, owner: WorkflowOwner, workflow: WorkflowSnapshot) -> None:
        raise AssertionError(f"Unexpected snippet completion for {context.account_id}/{owner.id}/{workflow.id}")


def _graph(node_type: str) -> dict[str, object]:
    return {"nodes": [{"id": "forbidden", "data": {"type": node_type}}], "edges": []}


def _command(graph: dict[str, object]) -> DraftSyncCommand:
    return DraftSyncCommand(
        graph=graph,
        features={},
        unique_hash=None,
        is_collaborative=False,
        environment_upserts=None,
        environment_deletions=[],
        conversation_variables=[],
    )


def _seed(sessions: sessionmaker[Session], *, published_graph: dict[str, object] | None = None) -> None:
    with sessions.begin() as session:
        snippet = CustomizedSnippet(
            id=OWNER.id,
            tenant_id=CONTEXT.active_workspace_id,
            name="Snippet",
            description="",
            type=SnippetType.NODE,
            created_by=CONTEXT.account_id,
        )
        draft = make_workflow(workflow_id="draft-1", app_id=OWNER.id, kind=WorkflowKind.SNIPPET, graph=VALID_GRAPH)
        session.add_all([snippet, draft])
        if published_graph is not None:
            session.add(
                make_workflow(
                    workflow_id="published-1",
                    app_id=OWNER.id,
                    kind=WorkflowKind.SNIPPET,
                    version="2026-01-01",
                    graph=published_graph,
                )
            )


def _service(sessions: sessionmaker[Session]) -> WorkflowDraftService[WorkflowAgentBindingRepository]:
    definitions = WorkflowDraftRepository(sessions)
    return WorkflowDraftService(
        definitions=definitions,
        lifecycle=_SnippetLifecycle(definitions),
        retirement=WorkflowAgentRetirementService(WorkflowAgentRetirementRepository(sessions)),
        agent_services=WorkflowAgentPublishService,
    )


@pytest.mark.parametrize("node_type", ["start", "human-input", "knowledge-retrieval"])
def test_snippet_sync_rejects_forbidden_nodes_without_changing_draft(
    sqlite_session_factory: sessionmaker[Session], node_type: str
) -> None:
    _seed(sqlite_session_factory)

    with pytest.raises(ValueError, match=f"forbidden:{node_type}"):
        _service(sqlite_session_factory).sync(CONTEXT, OWNER, _command(_graph(node_type)))

    with sqlite_session_factory() as session:
        draft = session.get(Workflow, "draft-1")
        assert draft is not None
        assert draft.graph_dict == VALID_GRAPH


def test_snippet_import_rejects_materialized_forbidden_graph_and_rolls_back(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _seed(sqlite_session_factory)

    with pytest.raises(ValueError, match="forbidden:knowledge-retrieval"):
        _service(sqlite_session_factory).sync(
            CONTEXT,
            OWNER,
            _command(VALID_GRAPH),
            materialize=lambda _draft: DraftImportResult(_graph("knowledge-retrieval"), set()),
        )

    with sqlite_session_factory() as session:
        draft = session.get(Workflow, "draft-1")
        assert draft is not None
        assert draft.graph_dict == VALID_GRAPH


def test_snippet_restore_rejects_forbidden_published_graph_without_changing_draft(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _seed(sqlite_session_factory, published_graph=_graph("start"))

    with pytest.raises(ValueError, match="forbidden:start"):
        _service(sqlite_session_factory).restore(CONTEXT, OWNER, "published-1")

    with sqlite_session_factory() as session:
        draft = session.get(Workflow, "draft-1")
        assert draft is not None
        assert draft.graph_dict == VALID_GRAPH
