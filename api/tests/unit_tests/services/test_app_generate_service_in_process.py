"""A streaming run inside a Celery task must not wait for another pool slot."""

import json
from collections.abc import Callable, Generator
from typing import Literal, cast

import pytest
import pytest_mock
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimit
from enums import DeploymentEdition
from models.model import Account, App, AppMode
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.workflow_runtime.workflow_generator import BuilderExecutionAdmission
from tests.unit_tests.installed_spies import installed_mock


def _account() -> Account:
    account = Account(name="Owner", email="owner@example.invalid")
    account.id = "account-1"
    return account


class _RefusalAdmission:
    """Record only the refusal callback; these paths must not execute admission."""

    def __init__(self) -> None:
        self.refusals: list[tuple[Exception, bool]] = []

    def on_refusal(self, error: Exception, *, preworker: bool = False) -> None:
        self.refusals.append((error, preworker))


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("ending", ["complete", "close", "error"])
def test_in_process_stream_does_not_enqueue_a_child_task_and_releases_its_rate_limit(
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    mode: AppMode,
    ending: str,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    app = App(id="app-1", tenant_id="tenant", mode=mode)
    mocker.patch.object(app, "is_agent_with_session", return_value=False)
    user = _account()
    workflow = Workflow(created_by="account-1")
    mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
    monkeypatch.setattr(AppGenerateService, "_get_max_active_requests", lambda _: 0)
    monkeypatch.setattr(module.session_factory, "get_session_maker", sessionmaker)

    limiter = RateLimit(app.id, 0)
    mocker.patch.object(limiter, "enter", return_value="request-1")
    mocker.patch.object(limiter, "exit")
    enqueue = mocker.patch.object(
        module.workflow_based_app_execution_task,
        "delay",
        side_effect=AssertionError("the parent task owns the only worker slot"),
    )
    closed: list[bool] = []

    def stream() -> Generator[dict[str, object]]:
        try:
            yield {"event": "workflow_started", "workflow_run_id": "run-1", "data": {"inputs": {"query": "hello"}}}
            if ending == "error":
                raise ValueError("runtime failed")
            yield {"event": "workflow_finished", "workflow_run_id": "run-1", "data": {"status": "succeeded"}}
        finally:
            closed.append(True)

    generator_type = module.WorkflowAppGenerator if mode == AppMode.WORKFLOW else module.AdvancedChatAppGenerator
    generate = mocker.patch.object(generator_type, "generate", side_effect=lambda **_: stream())

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
    _installed_spy_1 = installed_mock(limiter.exit)
    _installed_spy_1.assert_not_called()

    if ending == "error":
        with pytest.raises(ValueError, match="runtime failed"):
            list(response)
    elif ending == "close":
        response.close()
    else:
        assert len(list(response)) == 1

    assert closed == [True]
    _installed_spy_2 = installed_mock(limiter.exit)
    _installed_spy_2.assert_called_once_with("request-1")


def test_posted_live_mode_cannot_select_builder_policy(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    app = App(id="app", tenant_id="tenant", mode="workflow")
    user = Account(name="Owner", email="owner@example.invalid")
    user.id = "account"
    workflow = Workflow(created_by="account")
    marker = context()
    mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)
    mocker.patch.object(module, "restricted_admission_snapshot")
    monkeypatch.setattr(app, "is_agent_with_session", lambda **_: False)
    monkeypatch.setattr(AppGenerateService, "_ensure_workflow_service_mode_available", lambda **_: None)
    monkeypatch.setattr(AppGenerateService, "_get_max_active_requests", lambda _: 0)
    monkeypatch.setattr(module.session_factory, "get_session_maker", sessionmaker)
    limiter = RateLimit(app.id, 0)
    mocker.patch.object(limiter, "enter", return_value="request")
    mocker.patch.object(limiter, "exit")
    generate = mocker.patch.object(
        module.WorkflowAppGenerator, "generate", side_effect=lambda **_: (event for event in ())
    )
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
                builder_execution_admit=cast(BuilderExecutionAdmission, _RefusalAdmission()) if policy else None,
            )
            list(response)
        assert generate.call_args.kwargs["builder_execution"] is policy
    assert marker.mode == "restricted"
    _installed_spy_3 = installed_mock(limiter.exit)
    assert _installed_spy_3.call_count == 2


@pytest.mark.parametrize("mode", ["advanced-chat", "agent", "agent-chat"])
def test_restricted_dispatch_rejects_other_modes_before_guardrails(
    mocker: pytest_mock.MockerFixture, mode: AppMode
) -> None:
    from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    guardrails = mocker.patch.object(
        AppGenerateService,
        "_run_with_guardrails",
        side_effect=AssertionError("must refuse before native dispatch"),
    )
    with Session() as session, pytest.raises(BuilderExecutionPolicyError):
        AppGenerateService.generate(
            App(id="app", tenant_id="tenant", mode=mode),
            _account(),
            {"inputs": {}},
            InvokeFrom.DEBUGGER,
            session=session,
            workflow_execution_mode="in_process",
            builder_execution=context(),
            builder_execution_admit=cast(BuilderExecutionAdmission, _RefusalAdmission()),
        )
    guardrails.assert_not_called()


def test_restricted_marker_cannot_enter_agent_dispatch_of_workflow_app(mocker: pytest_mock.MockerFixture) -> None:
    from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError
    from tests.unit_tests.core.app.apps.test_builder_execution_admission import context

    app = App(id="app", tenant_id="tenant", mode="workflow")
    mocker.patch.object(app, "is_agent_with_session", return_value=True)
    agent = mocker.patch.object(module.AgentChatAppGenerator, "generate")
    with pytest.raises(BuilderExecutionPolicyError):
        AppGenerateService._dispatch_generate(
            app_model=app,
            user=_account(),
            args={"inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
            root_node_id=None,
            session=Session(),
            rate_limit=RateLimit(app.id, 0),
            request_id="request",
            workflow_execution_mode="in_process",
            builder_execution=context(),
            builder_execution_admit=cast(BuilderExecutionAdmission, _RefusalAdmission()),
        )
    agent.assert_not_called()


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("transport", ["in_process", "celery"])
def test_pre_generator_tool_admission_failure_has_qualified_preparation_boundary(
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    transport: Literal["in_process", "celery"],
) -> None:
    from core.tools.errors import ToolProviderCredentialValidationError
    from services.dify_builder.native_launch_observation import NativeLaunchObservation

    app = App(id="app-1", tenant_id="tenant", mode=mode)
    mocker.patch.object(app, "is_agent_with_session", return_value=False)
    user = _account()
    mocker.patch.object(AppGenerateService, "_get_workflow", return_value=Workflow(created_by=user.id))
    monkeypatch.setattr(
        AppGenerateService,
        "_run_with_guardrails",
        staticmethod(lambda **kwargs: kwargs["action"](RateLimit(app.id, 0), "request")),
    )
    mocker.patch.object(
        AppGenerateService,
        "_admit_normal_draft_tools",
        side_effect=ToolProviderCredentialValidationError("metadata service unavailable"),
    )
    generator = mocker.patch.object(
        module.WorkflowAppGenerator, "generate", side_effect=AssertionError("no worker dispatch")
    )
    chat_generator = mocker.patch.object(
        module.AdvancedChatAppGenerator, "generate", side_effect=AssertionError("no worker dispatch")
    )
    observation = NativeLaunchObservation()
    with (
        observation.track(),
        Session() as session,
        pytest.raises(ToolProviderCredentialValidationError, match="metadata service unavailable"),
    ):
        AppGenerateService.generate(
            app, user, {"inputs": {}}, InvokeFrom.DEBUGGER, session=session, workflow_execution_mode=transport
        )
    assert observation.failed_before_dispatch is (transport == "in_process")
    generator.assert_not_called()
    chat_generator.assert_not_called()
