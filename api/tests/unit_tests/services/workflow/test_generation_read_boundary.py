"""Generation must release request reads before waiting for a worker's response."""

import json
from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from core.app.apps import base_app_queue_manager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.ops.ops_trace_manager import TraceQueueManager
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.workflow import Workflow, WorkflowType
from services.app.generation.runtime import AppGenerationRuntime
from services.app_generate_service import AppGenerateService
from services.workflow.execution.adapters.chatflow import app_generator as chatflow_module
from services.workflow.execution.adapters.workflow import app_generator as workflow_module
from services.workflow.variable_contracts import WorkflowExecutionVariables
from tests.unit_tests.services.test_app_generate_service import _DummyRateLimit


@pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
@pytest.mark.parametrize("fail_while_waiting", [False, True])
def test_blocking_generation_detaches_request_inputs_before_waiting(
    app: Flask,
    sqlite_session: Session,
    workflow_runtime: AppGenerationRuntime,
    workflow_variables: WorkflowExecutionVariables,
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    fail_while_waiting: bool,
) -> None:
    application = App(
        id="app",
        tenant_id="tenant",
        name="App",
        mode=mode,
        description="",
        enable_site=False,
        enable_api=True,
        max_active_requests=None,
    )
    user = EndUser(
        id="user",
        tenant_id="tenant",
        app_id="app",
        type=EndUserType.SERVICE_API,
        session_id="external-user",
    )
    workflow = Workflow.new(
        tenant_id="tenant",
        app_id="app",
        type=WorkflowType.CHAT.value if mode == AppMode.ADVANCED_CHAT else WorkflowType.WORKFLOW.value,
        version="1",
        created_by="owner",
        features="{}",
        graph=json.dumps(
            {"nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}], "edges": []}
        ),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    application.workflow_id = workflow.id
    sqlite_session.add_all([application, user, workflow])
    sqlite_session.commit()
    sqlite_session.refresh(application)
    assert sqlite_session.in_transaction()

    trace_queue_manager = create_autospec(TraceQueueManager, instance=True, spec_set=True)
    if mode == AppMode.ADVANCED_CHAT:
        generator = chatflow_module.AdvancedChatAppGenerator
        converter = chatflow_module.AdvancedChatAppGenerateResponseConverter
        monkeypatch.setattr(chatflow_module, "TraceQueueManager", Mock(return_value=trace_queue_manager))
    else:
        generator = workflow_module.WorkflowAppGenerator
        converter = workflow_module.WorkflowAppGenerateResponseConverter
        monkeypatch.setattr(workflow_module, "TraceQueueManager", Mock(return_value=trace_queue_manager))
    monkeypatch.setattr("services.app_generate_service.RateLimit", _DummyRateLimit)
    monkeypatch.setattr(base_app_queue_manager.redis_client, "setex", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(generator, "_generate_worker", staticmethod(lambda **_kwargs: None))
    monkeypatch.setattr(converter, "convert", lambda *, response, **_kwargs: response)
    waits: list[str] = []

    def wait_for_response(_self: object, **_kwargs: object) -> dict[str, str]:
        assert not sqlite_session.in_transaction()
        for row in (application, user, workflow):
            assert inspect(row).detached
        assert application.name == "App"
        assert workflow.graph_dict["nodes"][0]["id"] == "start"
        assert not sqlite_session.in_transaction()
        waits.append("response")
        if fail_while_waiting:
            raise ValueError("model response failed")
        return {"answer": "done"}

    monkeypatch.setattr(
        generator,
        "_handle_advanced_chat_response" if mode == AppMode.ADVANCED_CHAT else "_handle_response",
        wait_for_response,
    )
    with app.app_context():
        if fail_while_waiting:
            with pytest.raises(ValueError, match="model response failed"):
                AppGenerateService.generate(
                    app_model=application,
                    user=user,
                    args={"query": "Hello", "inputs": {}},
                    invoke_from=InvokeFrom.SERVICE_API,
                    streaming=False,
                    session=sqlite_session,
                    variables=workflow_variables,
                    runtime=workflow_runtime,
                )
        else:
            result = AppGenerateService.generate(
                app_model=application,
                user=user,
                args={"query": "Hello", "inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                session=sqlite_session,
                variables=workflow_variables,
                runtime=workflow_runtime,
            )
            assert result == {"answer": "done"}
    assert waits == ["response"]
    assert not sqlite_session.in_transaction()
