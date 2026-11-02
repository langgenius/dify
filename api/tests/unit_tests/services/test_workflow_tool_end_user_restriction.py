import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import Engine, create_engine, event, select
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.pool import QueuePool

from enums import DeploymentEdition
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from services.tools.workflow_tools_manage_service import WorkflowToolManageService
from services.workflow.tool_credentials import WorkflowToolEndUserAuthError, first_end_user_tool_node
from services.workflow_service import WorkflowService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account


def _graph(source: str | None) -> dict[str, object]:
    data: dict[str, object] = {
        "type": "tool",
        "provider_type": "builtin",
        "provider_id": "provider",
        "tool_name": "tool",
        "test_credential_id": "test",
    }
    if source is not None:
        data["credential_source"] = source
    if source == "end_user":
        data["end_user_auth"] = {
            "allowed_credential_types": ["oauth2"],
            "oauth_client_type": "custom",
            "purpose": "Test",
        }
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
        created_by="user",
    )
    workflow.features = "{}"
    workflow.environment_variables = []
    workflow.conversation_variables = []
    workflow.rag_pipeline_variables = []
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
    service = WorkflowService(sessionmaker(bind=sqlite_engine))
    with (
        patch("services.workflow_service.app_published_workflow_was_updated") as published,
        patch.object(service, "_validate_publish_tool_credentials"),
    ):
        with pytest.raises(WorkflowToolEndUserAuthError, match="Node node-1"):
            service.publish_workflow(session=sqlite_session, app_model=app, account=make_account())
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


@pytest.mark.parametrize("update", [False, True])
def test_tool_writes_with_single_connection_pool(
    update: bool, sqlite_session: Session, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _app_and_workflow(sqlite_session, "workspace")
    engine = create_engine(sqlite_engine.url, poolclass=QueuePool, pool_size=1, max_overflow=0, pool_timeout=0.1)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr("services.tools.workflow_tools_manage_service.db", SimpleNamespace(engine=engine))
    monkeypatch.setattr("core.tools.tool_label_manager.db", SimpleNamespace(engine=engine))
    monkeypatch.setattr("core.db.session_factory._session_maker", factory)
    try:
        if update:
            with factory.begin() as session:
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
                session.add(provider)
            WorkflowToolManageService.update_workflow_tool(
                "user", "tenant", provider.id, "tool", "Updated", {}, "", [], labels=["utilities"]
            )
        else:
            WorkflowToolManageService.create_workflow_tool(
                user_id="user",
                tenant_id="tenant",
                workflow_app_id="app",
                name="tool",
                label="Created",
                icon={},
                description="",
                parameters=[],
                labels=["utilities"],
            )
        with factory() as session:
            saved = session.scalar(select(WorkflowToolProvider))
            assert saved is not None
            assert saved.version == "1"
            assert saved.label == ("Updated" if update else "Created")
    finally:
        engine.dispose()


@pytest.mark.parametrize("existing_tool", [False, True])
def test_publish_checks_tool_after_external_validation(
    existing_tool: bool, sqlite_session: Session, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = _app_and_workflow(sqlite_session, "end_user", draft=True)
    if existing_tool:
        sqlite_session.add(
            WorkflowToolProvider(
                tenant_id="tenant",
                app_id="app",
                user_id="user",
                name="tool",
                label="Tool",
                icon="{}",
                description="",
                version="old",
            )
        )
        sqlite_session.commit()
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    service = WorkflowService(sessionmaker(bind=sqlite_engine))
    locks: list[str] = []

    def record_lock(state: ORMExecuteState) -> None:
        if "FOR UPDATE" in str(state.statement):
            locks.append(str(state.statement))

    def validate_before_lock(*_args: object, **_kwargs: object) -> None:
        assert not locks

    def billing_before_lock(*_args: object, **_kwargs: object) -> dict[str, dict[str, str]]:
        assert not locks
        return {"subscription": {"plan": "professional"}}

    event.listen(sqlite_session, "do_orm_execute", record_lock)
    try:
        with (
            patch.object(service, "_validate_publish_tool_credentials", side_effect=validate_before_lock) as auth,
            patch.object(service, "_validate_workflow_credentials", side_effect=validate_before_lock) as policy,
            patch("services.workflow_service.SystemFeatureService.is_plugin_manager_enabled", return_value=True),
            patch("services.workflow_service.BillingService.get_info", side_effect=billing_before_lock) as billing,
            patch("services.workflow_service.app_published_workflow_was_updated") as published,
        ):
            if existing_tool:
                with pytest.raises(WorkflowToolEndUserAuthError, match="Node node-1"):
                    service.publish_workflow(session=sqlite_session, app_model=app, account=make_account())
                published.send.assert_not_called()
            else:
                result = service.publish_workflow(session=sqlite_session, app_model=app, account=make_account())
                assert result.version != Workflow.VERSION_DRAFT
            auth.assert_called_once()
            policy.assert_called_once()
            billing.assert_called_once()
            assert len(locks) == 2
    finally:
        event.remove(sqlite_session, "do_orm_execute", record_lock)
