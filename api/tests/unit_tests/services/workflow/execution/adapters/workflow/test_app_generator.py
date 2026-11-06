"""Both workflow-backed generators restore transient trace scopes on resume."""

import pytest
from dify_trace_sdk.events import TraceEvent
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    UserFrom,
    WorkflowAppGenerateEntity,
)
from extensions.application_services.workflow import WorkflowExecutionDependencies
from extensions.tracing import bind_tracing, create_trace_scope
from graphon.runtime import RuntimeState, VariablePool
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from services.workflow.execution.adapters.chatflow.app_generator import AdvancedChatAppGenerator
from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_message, make_workflow
from tests.helpers.unit.services.tracing_ports import NoTracingPolicies, RecordingTracingHooks, kernel_trace_scopes


class Recorder:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("preserve_scope", [True, False])
def test_resume_restores_or_preserves_trace_scope(
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    workflow_runtime: WorkflowExecutionDependencies,
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    preserve_scope: bool,
) -> None:
    """Resume carries saved correlation without replacing an existing request scope."""
    recorder = Recorder()
    monkeypatch.setattr(app, "extensions", dict(app.extensions))
    bind_tracing(
        app,
        scopes=kernel_trace_scopes(recorder, policies=NoTracingPolicies(), enterprise_enabled=True),
        hooks=RecordingTracingHooks(None),
    )
    app_model = make_app(app_id="app", tenant_id="tenant", mode=mode)
    user = make_account(account_id="user")
    with sqlite_session_factory.begin() as session:
        session.add(make_workflow(workflow_id="workflow", tenant_id="tenant", app_id="app"))
    workflow = workflow_runtime.contexts.workflow(tenant_id="tenant", app_id="app", workflow_id="workflow")
    config = WorkflowUIBasedAppConfig(tenant_id="tenant", app_id="app", app_mode=mode, workflow_id=workflow.id)
    entity: AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity
    if mode == AppMode.ADVANCED_CHAT:
        entity = AdvancedChatAppGenerateEntity(
            task_id="task",
            app_config=config,
            inputs={},
            query="question",
            files=[],
            user_id=user.id,
            invoke_from=InvokeFrom.DEBUGGER,
            stream=True,
            workflow_run_id="run",
        )
    else:
        entity = WorkflowAppGenerateEntity(
            task_id="task",
            app_config=config,
            inputs={},
            files=[],
            user_id=user.id,
            invoke_from=InvokeFrom.DEBUGGER,
            stream=True,
            user_from=UserFrom.ACCOUNT,
            workflow_execution_id="run",
        )
    entity.extras = {"external_trace_id": "external", "trace_session_id": "session"}
    existing = create_trace_scope(
        tenant_id="tenant", app_id="app", app_tracing=None, user_id=user.id, extras=entity.extras
    )
    assert existing is not None
    entity.trace_scope = existing if preserve_scope else None
    captured: list[AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity] = []

    def capture(**kwargs: object) -> dict[str, str]:
        resumed = kwargs["application_generate_entity"]
        assert isinstance(resumed, AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity)
        captured.append(resumed)
        return {"status": "resumed"}

    execution_repo = workflow_runtime.execution_writer(
        tenant_id="tenant", user=user, app_id="app", triggered_from=WorkflowRunTriggeredFrom.APP_RUN
    )
    node_repo = workflow_runtime.node_writer(
        tenant_id="tenant", user=user, app_id="app", triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    )
    state = RuntimeState(workflow_id=workflow.id, variable_pool=VariablePool(), start_at=0)
    if isinstance(entity, AdvancedChatAppGenerateEntity):
        chatflow = AdvancedChatAppGenerator(
            runtime=workflow_runtime, execution_driver=workflow_runtime.execution_driver
        )
        monkeypatch.setattr(chatflow, "_generate", capture)
        result = chatflow.resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            conversation=make_conversation(conversation_id="conversation", app_id="app"),
            message=make_message(message_id="message", app_id="app", conversation_id="conversation"),
            application_generate_entity=entity,
            workflow_execution_repository=execution_repo,
            workflow_node_execution_repository=node_repo,
            graph_runtime_state=state,
        )
    else:
        generator = WorkflowAppGenerator(runtime=workflow_runtime, execution_driver=workflow_runtime.execution_driver)
        monkeypatch.setattr(generator, "_generate", capture)
        result = generator.resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            application_generate_entity=entity,
            workflow_execution_repository=execution_repo,
            workflow_node_execution_repository=node_repo,
            graph_runtime_state=state,
        )
    assert result == {"status": "resumed"}
    [resumed] = captured
    assert resumed.trace_scope is not None
    assert resumed.trace_scope.correlation == existing.correlation
    assert (resumed.trace_scope.tenant_id, resumed.trace_scope.app_id, resumed.trace_scope.user_id) == (
        "tenant",
        "app",
        "user",
    )
    assert (resumed.trace_scope is existing) == preserve_scope
    assert entity.trace_scope is (existing if preserve_scope else None)
    assert recorder.events == []
