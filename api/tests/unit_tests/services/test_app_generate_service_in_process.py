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
