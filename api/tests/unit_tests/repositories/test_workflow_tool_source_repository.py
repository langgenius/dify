import json

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.tools.workflow_as_tool.repository import WorkflowToolSource
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.workflow_tool_source_repository import SQLAlchemyWorkflowToolSourceRepository

_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_APP_ID = "33333333-3333-3333-3333-333333333333"
_PUBLISHED_WORKFLOW_ID = "44444444-4444-4444-4444-444444444444"
_DRAFT_WORKFLOW_ID = "55555555-5555-5555-5555-555555555555"
_ACCOUNT_ID = "66666666-6666-6666-6666-666666666666"
_PUBLISHED_VERSION = "published-version"

_GRAPH: dict[str, object] = {
    "nodes": [{"id": "start", "data": {"type": "start", "variables": list[object]()}}],
    "edges": list[object](),
}
_FEATURES: dict[str, object] = {"file_upload": {"enabled": False}}


def _persist_source(session_factory: sessionmaker[Session]) -> None:
    app = App(
        id=_APP_ID,
        tenant_id=_TENANT_ID,
        name="Workflow Tool source",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        icon=None,
        icon_background=None,
        enable_site=False,
        enable_api=False,
        is_public=False,
        max_active_requests=None,
        created_by=_ACCOUNT_ID,
    )
    published = Workflow(
        id=_PUBLISHED_WORKFLOW_ID,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        type=WorkflowType.WORKFLOW,
        kind=WorkflowKind.STANDARD,
        version=_PUBLISHED_VERSION,
        graph=json.dumps(_GRAPH),
        features=json.dumps(_FEATURES),
        created_by=_ACCOUNT_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    draft = Workflow(
        id=_DRAFT_WORKFLOW_ID,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        type=WorkflowType.WORKFLOW,
        kind=WorkflowKind.STANDARD,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(_GRAPH),
        features=json.dumps(_FEATURES),
        created_by=_ACCOUNT_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    app.workflow_id = published.id
    with session_factory.begin() as session:
        session.add_all((app, published, draft))


def test_get_source_projects_pinned_workflow(sqlite_session_factory: sessionmaker[Session]) -> None:
    _persist_source(sqlite_session_factory)
    repository = SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory)

    source = repository.get_source(
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        workflow_id=_PUBLISHED_WORKFLOW_ID,
        version=_PUBLISHED_VERSION,
    )

    assert source == WorkflowToolSource(
        app_id=_APP_ID,
        workflow_id=_PUBLISHED_WORKFLOW_ID,
        graph_config=_GRAPH,
        features_dict=_FEATURES,
        environment_variables=(),
        workflow_kind=WorkflowKind.STANDARD,
    )


@pytest.mark.parametrize(
    ("tenant_id", "workflow_id", "version"),
    [
        pytest.param(_OTHER_TENANT_ID, _PUBLISHED_WORKFLOW_ID, _PUBLISHED_VERSION, id="wrong-tenant"),
        pytest.param(_TENANT_ID, _PUBLISHED_WORKFLOW_ID, "wrong-version", id="wrong-version"),
        pytest.param(_TENANT_ID, _DRAFT_WORKFLOW_ID, Workflow.VERSION_DRAFT, id="draft"),
    ],
)
def test_get_source_rejects_unavailable_source(
    sqlite_session_factory: sessionmaker[Session],
    tenant_id: str,
    workflow_id: str,
    version: str,
) -> None:
    _persist_source(sqlite_session_factory)
    repository = SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory)

    assert (
        repository.get_source(
            tenant_id=tenant_id,
            app_id=_APP_ID,
            workflow_id=workflow_id,
            version=version,
        )
        is None
    )
