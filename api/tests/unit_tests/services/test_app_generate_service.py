from unittest.mock import MagicMock

import services.app_generate_service as app_generate_service_module
from models.model import AppMode
from services.app_generate_service import AppGenerateService


class _DummyRateLimit:
    def __init__(self, client_id: str, max_active_requests: int) -> None:
        self.client_id = client_id
        self.max_active_requests = max_active_requests

    @staticmethod
    def gen_request_key() -> str:
        return "dummy-request-id"

    def enter(self, request_id: str | None = None) -> str:
        return request_id or "dummy-request-id"

    def exit(self, request_id: str) -> None:
        return None

    def generate(self, generator, request_id: str):
        return generator


def test_workflow_blocking_injects_pause_state_config(mocker, monkeypatch):
    monkeypatch.setattr(app_generate_service_module.dify_config, "BILLING_ENABLED", False)
    mocker.patch("services.app_generate_service.RateLimit", _DummyRateLimit)

    workflow = MagicMock()
    workflow.id = "workflow-id"
    workflow.created_by = "owner-id"

    mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)

    generator_spy = mocker.patch(
        "services.app_generate_service.WorkflowAppGenerator.generate",
        return_value={"result": "ok"},
    )

    app_model = MagicMock()
    app_model.mode = AppMode.WORKFLOW
    app_model.id = "app-id"
    app_model.tenant_id = "tenant-id"
    app_model.max_active_requests = 0
    app_model.is_agent = False

    user = MagicMock()
    user.id = "user-id"

    result = AppGenerateService.generate(
        app_model=app_model,
        user=user,
        args={"inputs": {"k": "v"}},
        invoke_from=MagicMock(),
        streaming=False,
    )

    assert result == {"result": "ok"}

    call_kwargs = generator_spy.call_args.kwargs
    pause_state_config = call_kwargs.get("pause_state_config")
    assert pause_state_config is not None
    assert pause_state_config.state_owner_user_id == "owner-id"


def test_advanced_chat_blocking_returns_dict_and_does_not_use_event_retrieval(mocker, monkeypatch):
    """
    Regression test: ADVANCED_CHAT in blocking mode should return a plain dict
    (non-streaming), and must not go through the async retrieve_events path.
    Keeps behavior consistent with WORKFLOW blocking branch.
    """
    # Disable billing and stub RateLimit to a no-op that just passes values through
    monkeypatch.setattr(app_generate_service_module.dify_config, "BILLING_ENABLED", False)
    mocker.patch("services.app_generate_service.RateLimit", _DummyRateLimit)

    # Arrange a fake workflow and wire AppGenerateService._get_workflow to return it
    workflow = MagicMock()
    workflow.id = "workflow-id"
    mocker.patch.object(AppGenerateService, "_get_workflow", return_value=workflow)

    # Spy on the streaming retrieval path to ensure it's NOT called
    retrieve_spy = mocker.patch(
        "services.app_generate_service.AdvancedChatAppGenerator.retrieve_events"
    )

    # Make AdvancedChatAppGenerator.generate return a plain dict when streaming=False
    generate_spy = mocker.patch(
        "services.app_generate_service.AdvancedChatAppGenerator.generate",
        return_value={"result": "ok"},
    )

    # Minimal app model for ADVANCED_CHAT
    app_model = MagicMock()
    app_model.mode = AppMode.ADVANCED_CHAT
    app_model.id = "app-id"
    app_model.tenant_id = "tenant-id"
    app_model.max_active_requests = 0
    app_model.is_agent = False

    user = MagicMock()
    user.id = "user-id"

    # Must include query and inputs for AdvancedChatAppGenerator
    args = {"workflow_id": "wf-1", "query": "hello", "inputs": {}}

    # Act: call service with streaming=False (blocking mode)
    result = AppGenerateService.generate(
        app_model=app_model,
        user=user,
        args=args,
        invoke_from=MagicMock(),
        streaming=False,
    )

    # Assert: returns the dict from generate(), and did not call retrieve_events()
    assert result == {"result": "ok"}
    assert generate_spy.call_args.kwargs.get("streaming") is False
    retrieve_spy.assert_not_called()
