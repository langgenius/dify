import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from services.tools.workflow_tools_manage_service import WorkflowToolManageService
from services.workflow.tool_credentials import WorkflowToolEndUserAuthError, first_end_user_tool_node
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account


def _graph(source: str | None) -> dict:
    data = {"type": "tool", "test_credential_id": "test", "end_user_auth": {"oauth_client_type": "custom"}}
    if source is not None:
        data["credential_source"] = source
    return {"nodes": [{"id": "node-1", "data": data}], "edges": []}


def _app_and_workflow(session: Session, source: str | None, *, draft: bool = False) -> App:
    app = App(
        id="app",
        tenant_id="tenant",
        name="App",
        mode=AppMode.WORKFLOW,
        workflow_id="published",
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    workflow = Workflow(
        id="draft" if draft else "published",
        tenant_id="tenant",
        app_id="app",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT if draft else "1",
        graph=json.dumps(_graph(source)),
        features="{}",
        created_by="user",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    session.add_all([app, workflow])
    session.commit()
    return app


@pytest.mark.parametrize(
    ("source", "expected"), [("end_user", "node-1"), ("workspace", None), (None, None), ("reuse_node", None)]
)
def test_personal_credential_detection(source: str | None, expected: str | None) -> None:
    assert first_end_user_tool_node(_graph(source)) == expected


@pytest.mark.parametrize("source", ["end_user", "workspace", None])
def test_convert_published_workflow(
    source: str | None, sqlite_session: Session, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _app_and_workflow(sqlite_session, source)
    monkeypatch.setattr("services.tools.workflow_tools_manage_service.db", SimpleNamespace(engine=sqlite_engine))
    with patch("services.tools.workflow_tools_manage_service.WorkflowToolProviderController.from_db"):
        if source == "end_user":
            with pytest.raises(WorkflowToolEndUserAuthError, match="Node node-1"):
                WorkflowToolManageService.create_workflow_tool(
                    user_id="user",
                    tenant_id="tenant",
                    workflow_app_id="app",
                    name="tool",
                    label="Tool",
                    icon={},
                    description="",
                    parameters=[],
                )
        else:
            WorkflowToolManageService.create_workflow_tool(
                user_id="user",
                tenant_id="tenant",
                workflow_app_id="app",
                name="tool",
                label="Tool",
                icon={},
                description="",
                parameters=[],
            )
    provider = sqlite_session.scalar(select(WorkflowToolProvider))
    assert (provider is None) == (source == "end_user")


def test_publish_personal_credentials_rejected_for_existing_tool(
    sqlite_session: Session, sqlite_engine: Engine
) -> None:
    app = _app_and_workflow(sqlite_session, "end_user", draft=True)
    provider = WorkflowToolProvider(
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        name="tool",
        label="Tool",
        icon="{}",
        description="",
        version="1",
    )
    sqlite_session.add(provider)
    sqlite_session.commit()
    with patch("services.workflow_service.app_published_workflow_was_updated") as published:
        with pytest.raises(WorkflowToolEndUserAuthError, match="Node node-1"):
            WorkflowService(sessionmaker(bind=sqlite_engine)).publish_workflow(
                session=sqlite_session, app_model=app, account=make_account()
            )
    published.send.assert_not_called()
    assert list(sqlite_session.scalars(select(Workflow))) == [sqlite_session.get(Workflow, "draft")]
    assert app.workflow_id == "published"


def test_update_tool_cannot_pin_legacy_published_personal_credentials(
    sqlite_session: Session, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _app_and_workflow(sqlite_session, "end_user")
    provider = WorkflowToolProvider(
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        name="tool",
        label="Tool",
        icon="{}",
        description="",
        version="old",
    )
    sqlite_session.add(provider)
    sqlite_session.commit()
    monkeypatch.setattr("services.tools.workflow_tools_manage_service.db", SimpleNamespace(engine=sqlite_engine))
    with pytest.raises(WorkflowToolEndUserAuthError, match="Node node-1"):
        WorkflowToolManageService.update_workflow_tool("user", "tenant", provider.id, "tool", "Changed", {}, "", [])
    sqlite_session.refresh(provider)
    assert provider.version == "old"
    assert provider.label == "Tool"


def test_personal_credentials_can_reach_validation_for_non_tool_app(
    sqlite_session: Session, sqlite_engine: Engine
) -> None:
    app = _app_and_workflow(sqlite_session, "end_user", draft=True)
    service = WorkflowService(sessionmaker(bind=sqlite_engine))
    with patch.object(service, "_validate_publish_tool_credentials", side_effect=ValueError("validation reached")):
        with patch("services.workflow_service.validate_llm_environment_model_references"):
            with pytest.raises(ValueError, match="validation reached"):
                service.publish_workflow(session=sqlite_session, app_model=app, account=make_account())
