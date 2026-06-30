from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import override
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.human_input import (
    FormDefinition,
    HumanInputFormKind,
    HumanInputFormStatus,
    SelectInputConfig,
    StringListSource,
    UserActionConfig,
    ValueSourceType,
)
from core.workflow.human_input_adapter import DeliveryMethodType
from graphon.entities import WorkflowExecution
from graphon.entities.pause_reason import HumanInputRequired
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input import (
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
    StandaloneWebAppRecipientPayload,
)
from models.model import App, AppMode, CustomizeTokenStrategy, Site
from models.workflow import WorkflowRun, WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.feature_service import FeatureModel


class _TestWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
    """Concrete repository for tests where save() is not under test."""

    @override
    def save(self, execution: WorkflowExecution) -> None:
        return None


def _create_app_with_site(session: Session) -> tuple[App, Account]:
    tenant = Tenant(name="Test Tenant")
    account = Account(name="Tester", email=f"tester-{uuid4()}@example.com")
    session.add_all([tenant, account])
    session.flush()

    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            current=True,
            role=TenantAccountRole.OWNER,
        )
    )

    app = App(
        tenant_id=tenant.id,
        name="Test App",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type="emoji",
        icon="app",
        icon_background="#ffffff",
        enable_site=True,
        enable_api=True,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add(app)
    session.flush()

    site = Site(
        app_id=app.id,
        title="Test Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#ffffff",
        description="desc",
        default_language="en",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        code=f"code-{uuid4().hex[:8]}",
        prompt_public=False,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )
    session.add(site)
    session.flush()
    return app, account


def _build_resumption_context(*, app: App, workflow_run: WorkflowRun, options: list[str]) -> WorkflowResumptionContext:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id=app.tenant_id,
        app_id=app.id,
        app_mode=AppMode.WORKFLOW,
        workflow_id=workflow_run.workflow_id,
    )
    generate_entity = WorkflowAppGenerateEntity(
        task_id="task-1",
        app_config=app_config,
        inputs={},
        files=[],
        user_id=str(uuid4()),
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
        call_depth=0,
        workflow_execution_id=workflow_run.id,
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    runtime_state.variable_pool.add(("start", "options"), options)
    return WorkflowResumptionContext(
        generate_entity=_WorkflowGenerateEntityWrapper(entity=generate_entity),
        serialized_graph_runtime_state=runtime_state.dumps(),
    )


def test_get_human_input_form_resolves_runtime_select_options(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, account = _create_app_with_site(db_session_with_containers)
    workflow_run = WorkflowRun(
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="v1",
        graph=None,
        inputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        outputs="{}",
        error=None,
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account.id,
        created_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db_session_with_containers.add(workflow_run)
    db_session_with_containers.flush()

    configured_input = SelectInputConfig(
        output_variable_name="decision",
        option_source=StringListSource(
            type=ValueSourceType.VARIABLE,
            selector=["start", "options"],
            value=["configured"],
        ),
    )
    expiration_time = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    form_definition = FormDefinition(
        form_content="Choose",
        rendered_content="Choose",
        inputs=[configured_input],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        expiration_time=expiration_time,
    )
    form = HumanInputForm(
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_run_id=workflow_run.id,
        form_kind=HumanInputFormKind.RUNTIME,
        node_id="human-node",
        form_definition=form_definition.model_dump_json(),
        rendered_content="Choose",
        status=HumanInputFormStatus.WAITING,
        expiration_time=expiration_time,
    )
    db_session_with_containers.add(form)
    db_session_with_containers.flush()

    delivery = HumanInputDelivery(
        form_id=form.id,
        delivery_method_type=DeliveryMethodType.WEBAPP,
        channel_payload="{}",
    )
    db_session_with_containers.add(delivery)
    db_session_with_containers.flush()

    access_token = f"hitl{uuid4().hex[:18]}"
    recipient = HumanInputFormRecipient(
        form_id=form.id,
        delivery_id=delivery.id,
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        recipient_payload=StandaloneWebAppRecipientPayload().model_dump_json(),
        access_token=access_token,
    )
    db_session_with_containers.add(recipient)
    db_session_with_containers.commit()

    context = _build_resumption_context(
        app=app,
        workflow_run=workflow_run,
        options=["approve", "reject"],
    )
    reason = HumanInputRequired(
        form_id=form.id,
        form_content="Choose",
        inputs=[configured_input],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="human-node",
        node_title="Human Input",
    )
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    workflow_run_repo = _TestWorkflowRunRepository(session_maker=sessionmaker(bind=engine, expire_on_commit=False))
    workflow_run_repo.create_workflow_pause(
        workflow_run_id=workflow_run.id,
        state_owner_user_id=account.id,
        state=context.dumps(),
        pause_reasons=[reason],
    )

    def mock_get_features(tenant_id: str, exclude_vector_space: bool = False) -> FeatureModel:
        features = FeatureModel(can_replace_logo=True, webapp_copyright_enabled=True)
        return features

    monkeypatch.setattr(
        "controllers.web.site.FeatureService.get_features",
        mock_get_features,
    )

    response = test_client_with_containers.get(f"/api/form/human_input/{access_token}")

    assert response.status_code == 200, response.get_data(as_text=True)
    body = json.loads(response.get_data(as_text=True))
    assert body["inputs"][0]["option_source"]["type"] == "variable"
    assert body["inputs"][0]["option_source"]["selector"] == ["start", "options"]
    assert body["inputs"][0]["option_source"]["value"] == ["approve", "reject"]
