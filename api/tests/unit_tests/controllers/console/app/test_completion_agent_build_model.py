"""Console completion controller tests for the request-scoped Agent build model.

Build chat may run on a model chosen only for that request, so authors can build
with one model while the Agent keeps its configured runtime model. These tests
cover the HTTP boundary: which requests may carry ``build_model`` and how it is
forwarded to generation.
"""

from collections.abc import Iterator
from inspect import unwrap

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from controllers.console.app import completion as completion_controller
from controllers.console.app.completion import AgentBuildChatFinalizeApi, AgentBuildChatFinalizePayload
from controllers.console.app.error import ProviderNotInitializeError
from core.errors.error import ProviderTokenNotInitError
from models.agent_config_entities import AgentSoulModelConfig
from models.model import AppMode
from tests.helpers.unit.model_factories import make_account, make_app

_BUILD_MODEL = {
    "plugin_id": "langgenius/anthropic",
    "model_provider": "langgenius/anthropic/anthropic",
    "model": "claude-build",
    "model_settings": {"temperature": 0.1},
}


def _capture_generation(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    captured: dict[str, object] = {}

    def generate(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"answer": "ok"}

    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)
    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        lambda **_kwargs: "build-conversation-1",
    )
    monkeypatch.setattr(completion_controller.helper, "compact_generate_response", lambda response: response)
    return captured


def _post_chat_message(
    app: Flask, session: Session, payload: dict[str, object], *, mode: AppMode = AppMode.AGENT
) -> object:
    with app.test_request_context(json={"inputs": {}, "query": "hello", "response_mode": "streaming", **payload}):
        return completion_controller._create_chat_message(
            current_tenant_id="tenant-1",
            current_user=make_account(),
            app_model=make_app(mode=mode),
            agent_id="agent-1",
            session=session,
        )


def test_build_chat_forwards_build_model_to_generation(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    captured = _capture_generation(monkeypatch)

    _post_chat_message(app, unbound_session, {"draft_type": "debug_build", "build_model": _BUILD_MODEL})

    args = captured["args"]
    assert isinstance(args, dict)
    assert args["draft_type"] == "debug_build"
    assert args["build_model"] == _BUILD_MODEL


def test_build_chat_without_build_model_sends_no_override(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    captured = _capture_generation(monkeypatch)

    _post_chat_message(app, unbound_session, {"draft_type": "debug_build"})

    args = captured["args"]
    assert isinstance(args, dict)
    assert "build_model" not in args


@pytest.mark.parametrize(
    ("payload", "mode"),
    [
        ({}, AppMode.AGENT),
        ({"draft_type": "draft"}, AppMode.AGENT),
        ({"draft_type": "debug_build"}, AppMode.CHAT),
    ],
    ids=["agent-preview-default", "agent-preview-explicit", "non-agent-app"],
)
def test_build_model_is_rejected_outside_agent_build_chat(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    unbound_session: Session,
    payload: dict[str, object],
    mode: AppMode,
) -> None:
    captured = _capture_generation(monkeypatch)

    with pytest.raises(BadRequest, match="build_model"):
        _post_chat_message(app, unbound_session, {**payload, "build_model": _BUILD_MODEL}, mode=mode)

    assert captured == {}


def test_malformed_build_model_is_rejected_before_generation(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    captured = _capture_generation(monkeypatch)
    incomplete_model = {key: value for key, value in _BUILD_MODEL.items() if key != "model"}

    with pytest.raises(ValidationError):
        _post_chat_message(app, unbound_session, {"draft_type": "debug_build", "build_model": incomplete_model})

    assert captured == {}


def test_unavailable_build_model_surfaces_provider_error(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    _capture_generation(monkeypatch)

    def reject_unavailable_model(**_kwargs: object) -> None:
        raise ProviderTokenNotInitError("Model claude-build credentials is not initialized.")

    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", reject_unavailable_model)

    with pytest.raises(ProviderNotInitializeError) as exc_info:
        _post_chat_message(app, unbound_session, {"draft_type": "debug_build", "build_model": _BUILD_MODEL})

    assert exc_info.value.code == 400


@pytest.mark.parametrize(
    ("build_model", "expected"),
    [(AgentSoulModelConfig.model_validate(_BUILD_MODEL), _BUILD_MODEL), (None, None)],
    ids=["with-build-model", "without-build-model"],
)
def test_build_chat_finalization_forwards_only_requested_build_model(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    unbound_session: Session,
    build_model: AgentSoulModelConfig | None,
    expected: dict[str, object] | None,
) -> None:
    captured: dict[str, object] = {}

    def generate(**kwargs: object) -> Iterator[str]:
        captured.update(kwargs)
        return iter(['data: {"event":"message_end"}\n\n'])

    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)
    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        lambda **_kwargs: "build-conversation-1",
    )

    with app.test_request_context():
        result = completion_controller._create_build_chat_finalization_message(
            session=unbound_session,
            current_user=make_account(),
            app_model=make_app(mode=AppMode.AGENT),
            current_tenant_id="tenant-1",
            agent_id="agent-1",
            build_model=build_model,
        )

    assert result == ({"result": "success"}, 200)
    args = captured["args"]
    assert isinstance(args, dict)
    assert args["draft_type"] == "debug_build"
    assert args.get("build_model") == expected


def test_build_chat_finalize_route_passes_request_build_model(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    captured: dict[str, object] = {}
    app_model = make_app(mode=AppMode.AGENT)
    monkeypatch.setattr(
        completion_controller.AgentRosterService,
        "get_agent_runtime_app_model",
        lambda _self, **_kwargs: app_model,
    )

    def create_finalization_message(**kwargs: object) -> tuple[dict[str, str], int]:
        captured.update(kwargs)
        return {"result": "success"}, 200

    monkeypatch.setattr(completion_controller, "_create_build_chat_finalization_message", create_finalization_message)
    payload = AgentBuildChatFinalizePayload.model_validate({"build_model": _BUILD_MODEL})

    with app.test_request_context():
        unwrap(AgentBuildChatFinalizeApi.post)(
            AgentBuildChatFinalizeApi(),
            payload,
            unbound_session,
            "tenant-1",
            make_account(),
            "00000000-0000-0000-0000-000000000001",
        )

    assert captured["build_model"] == AgentSoulModelConfig.model_validate(_BUILD_MODEL)
    assert captured["app_model"] is app_model
