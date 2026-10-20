"""Only explicit server injection selects the confirmed Workflow Agent profile."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as module
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import Account, App, AppMode, EndUser
from services.app_generate_service import AppGenerateService
from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError
from tests.unit_tests.services.dify_builder.native_testing.test_agent_context import marker


@pytest.mark.parametrize("case", ["celery", "published", "advanced_chat", "end_user", "restricted", "agent_mode"])
def test_confirmed_agent_refuses_unsupported_entry_before_guardrails(monkeypatch, case):
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    guardrails = MagicMock(side_effect=AssertionError("refuse before dispatch"))
    monkeypatch.setattr(AppGenerateService, "_run_with_guardrails", guardrails)
    app = App(id="app", tenant_id="tenant", mode=AppMode.ADVANCED_CHAT if case == "advanced_chat" else AppMode.WORKFLOW)
    if case == "agent_mode":
        app.mode = AppMode.AGENT
    with Session() as session, pytest.raises(BuilderExecutionPolicyError, match="unsupported_execution_transport"):
        AppGenerateService.generate(
            app_model=app,
            user=MagicMock(spec=EndUser if case == "end_user" else Account),
            args={"inputs": {}},
            invoke_from=InvokeFrom.SERVICE_API if case == "published" else InvokeFrom.DEBUGGER,
            session=session,
            workflow_execution_mode="celery" if case == "celery" else "in_process",
            builder_execution=context() if case == "restricted" else None,
            builder_agent_execution=marker(),
        )
    guardrails.assert_not_called()


@pytest.mark.parametrize("server_context", [False, True])
def test_confirmed_agent_server_context_and_preallocated_run_reach_workflow(monkeypatch, server_context):
    app = App(id="app", tenant_id="tenant", mode=AppMode.WORKFLOW)
    monkeypatch.setattr(app, "is_agent_with_session", lambda **_: False)
    monkeypatch.setattr(AppGenerateService, "_get_workflow", lambda *_, **__: MagicMock(created_by="actor"))
    monkeypatch.setattr(AppGenerateService, "_admit_normal_draft_tools", lambda **_: None)
    monkeypatch.setattr(AppGenerateService, "_ensure_workflow_service_mode_available", lambda **_: None)
    monkeypatch.setattr(module.session_factory, "get_session_maker", sessionmaker)
    monkeypatch.setattr(
        AppGenerateService,
        "_run_with_guardrails",
        lambda **kw: kw["action"](MagicMock(generate=lambda stream, *_, **__: stream), "request"),
    )
    captured = {}

    def generate(**kwargs):
        captured.update(kwargs)
        return iter(())

    monkeypatch.setattr(module.WorkflowAppGenerator, "generate", lambda _, **kw: generate(**kw))
    context = marker() if server_context else None
    with Session() as session:
        list(
            AppGenerateService.generate(
                app_model=app,
                user=MagicMock(spec=Account),
                args={"inputs": {}, "builder_agent_execution": marker().model_dump(mode="json")},
                invoke_from=InvokeFrom.DEBUGGER,
                session=session,
                workflow_execution_mode="in_process",
                builder_agent_execution=context,
            )
        )
    assert captured["builder_agent_execution"] == context
    if server_context:
        assert captured["workflow_run_id"] == context.native_run_id
    assert captured["pause_state_config"] is not None


def test_effective_agent_mode_cannot_drop_context(monkeypatch):
    app = MagicMock(spec=App)
    app.mode = AppMode.WORKFLOW
    app.is_agent_with_session.return_value = True
    generator = MagicMock(side_effect=AssertionError("AgentChat must not lose the marker"))
    monkeypatch.setattr(module.AgentChatAppGenerator, "generate", generator)
    with pytest.raises(BuilderExecutionPolicyError):
        AppGenerateService._dispatch_generate(
            app_model=app,
            user=MagicMock(spec=Account),
            args={"inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
            root_node_id=None,
            session=MagicMock(),
            rate_limit=MagicMock(),
            request_id="request",
            workflow_execution_mode="in_process",
            builder_agent_execution=marker(),
        )
    generator.assert_not_called()
