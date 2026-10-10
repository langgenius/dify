"""A streaming run inside a Celery task must not wait for another pool slot."""

import json
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimit
from enums import DeploymentEdition
from models.model import Account, App, AppMode
from services.app_generate_service import AppGenerateService


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("ending", ["complete", "close", "error"])
def test_in_process_stream_does_not_enqueue_a_child_task_and_releases_its_rate_limit(
    monkeypatch: pytest.MonkeyPatch, config_overrides, mode, ending
):
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    app = MagicMock(spec=App)
    app.id = "app-1"
    app.mode = mode
    app.is_agent_with_session.return_value = False
    user = MagicMock(spec=Account)
    workflow = MagicMock(created_by="account-1")
    monkeypatch.setattr(AppGenerateService, "_get_workflow", MagicMock(return_value=workflow))
    monkeypatch.setattr(AppGenerateService, "_get_max_active_requests", lambda _: 0)
    monkeypatch.setattr(module.session_factory, "get_session_maker", sessionmaker)

    limiter = RateLimit("in-process-stream-test", 0)
    limiter.enter = MagicMock(return_value="request-1")
    limiter.exit = MagicMock()
    monkeypatch.setattr(module, "RateLimit", MagicMock(return_value=limiter))
    enqueue = MagicMock(side_effect=AssertionError("the parent task owns the only worker slot"))
    monkeypatch.setattr(module.workflow_based_app_execution_task, "delay", enqueue)
    closed = []

    def stream():
        try:
            yield {"event": "workflow_started", "workflow_run_id": "run-1", "data": {"inputs": {"query": "hello"}}}
            if ending == "error":
                raise ValueError("runtime failed")
            yield {"event": "workflow_finished", "workflow_run_id": "run-1", "data": {"status": "succeeded"}}
        finally:
            closed.append(True)

    generate = MagicMock(side_effect=lambda **_: stream())
    generator_type = module.WorkflowAppGenerator if mode == AppMode.WORKFLOW else module.AdvancedChatAppGenerator
    monkeypatch.setattr(generator_type, "generate", generate)

    with Session() as session:
        response = AppGenerateService.generate(
            app_model=app,
            user=user,
            args={"inputs": {}, "query": "hello"},
            invoke_from=InvokeFrom.DEBUGGER,
            session=session,
            streaming=True,
            workflow_execution_mode="in_process",
        )

    assert json.loads(next(response).removeprefix("data: ")) == {
        "event": "workflow_started",
        "workflow_run_id": "run-1",
        "data": {"inputs": {"query": "hello"}},
    }
    assert generate.call_args.kwargs["args"] == {"inputs": {}, "query": "hello"}
    assert generate.call_args.kwargs["streaming"] is True
    assert generate.call_args.kwargs["pause_state_config"].state_owner_user_id == "account-1"
    enqueue.assert_not_called()
    limiter.exit.assert_not_called()

    if ending == "error":
        with pytest.raises(ValueError, match="runtime failed"):
            list(response)
    elif ending == "close":
        response.close()
    else:
        assert len(list(response)) == 1

    assert closed == [True]
    limiter.exit.assert_called_once_with("request-1")


def test_posted_live_mode_cannot_select_builder_policy(monkeypatch, config_overrides):
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    app = App(id="app", tenant_id="tenant", mode="workflow")
    user = Account(name="Owner", email="owner@example.invalid")
    user.id = "account"
    workflow = MagicMock(created_by="account")
    marker = context()
    monkeypatch.setattr(AppGenerateService, "_get_workflow", MagicMock(return_value=workflow))
    monkeypatch.setattr(module, "restricted_admission_snapshot", MagicMock())
    monkeypatch.setattr(app, "is_agent_with_session", lambda **_: False)
    monkeypatch.setattr(AppGenerateService, "_ensure_workflow_service_mode_available", lambda **_: None)
    monkeypatch.setattr(AppGenerateService, "_get_max_active_requests", lambda _: 0)
    monkeypatch.setattr(module.session_factory, "get_session_maker", sessionmaker)
    limiter = RateLimit("posted-live-mode-test", 0)
    limiter.enter = MagicMock(return_value="request")
    limiter.exit = MagicMock()
    monkeypatch.setattr(module, "RateLimit", MagicMock(return_value=limiter))
    generate = MagicMock(return_value=iter(()))
    monkeypatch.setattr(module.WorkflowAppGenerator, "generate", generate)
    for policy in (None, marker):
        with Session() as session:
            response = AppGenerateService.generate(
                app,
                user,
                {"inputs": {}, "execution_mode": "live_confirmed", "builder_execution": {"mode": "live_confirmed"}},
                InvokeFrom.DEBUGGER,
                session=session,
                workflow_execution_mode="in_process",
                builder_execution=policy,
                builder_execution_admit=MagicMock() if policy else None,
            )
            list(response)
        assert generate.call_args.kwargs["builder_execution"] is policy
    assert marker.mode == "restricted"
    assert limiter.exit.call_count == 2


@pytest.mark.parametrize("mode", ["advanced-chat", "agent", "agent-chat"])
def test_restricted_dispatch_rejects_other_modes_before_guardrails(monkeypatch, mode):
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    guardrails = MagicMock(side_effect=AssertionError("must refuse before native dispatch"))
    monkeypatch.setattr(AppGenerateService, "_run_with_guardrails", guardrails)
    with Session() as session, pytest.raises(BuilderExecutionPolicyError):
        AppGenerateService.generate(
            App(id="app", tenant_id="tenant", mode=mode),
            MagicMock(spec=Account),
            {"inputs": {}},
            InvokeFrom.DEBUGGER,
            session=session,
            workflow_execution_mode="in_process",
            builder_execution=context(),
            builder_execution_admit=MagicMock(),
        )
    guardrails.assert_not_called()


def test_restricted_marker_cannot_enter_agent_dispatch_of_workflow_app(monkeypatch):
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    app = MagicMock(spec=App)
    app.mode = "workflow"
    app.is_agent_with_session.return_value = True
    agent = MagicMock()
    monkeypatch.setattr(module.AgentChatAppGenerator, "generate", agent)
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
            builder_execution=context(),
            builder_execution_admit=MagicMock(),
        )
    agent.assert_not_called()
