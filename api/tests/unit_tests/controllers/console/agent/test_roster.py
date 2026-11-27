from collections.abc import Callable, Generator
from datetime import datetime
from inspect import getsource
from typing import Self, cast
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.console import console_ns
from controllers.console.agent import roster as roster_controller
from controllers.console.agent.roster import (
    AgentAppCopyApi,
    AgentAppListApi,
    AgentInviteOptionsApi,
)
from controllers.console.app import completion as completion_controller
from controllers.console.app.error import CompletionRequestError
from enums import DeploymentEdition
from models.account import Account, TenantAccountRole
from models.agent import Agent, AgentConfigDraftType, AgentScope, AgentSource
from models.model import App, AppMode, IconType
from tests.helpers.unit.model_factories import make_account
from tests.helpers.unit.rbac_fakes import RBACDomain


@pytest.fixture(autouse=True)
def rbac_services(monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain) -> None:
    monkeypatch.setattr(roster_controller, "application_services", lambda: rbac_domain)


def _version_response(version_id: str = "version-1") -> dict[str, object]:
    return {
        "id": version_id,
        "agent_id": "agent-1",
        "version": 1,
        "summary": None,
        "version_note": None,
        "created_by": "account-1",
        "created_at": None,
    }


def test_query_values_accepts_repeated_and_indexed_arrays() -> None:
    app = Flask(__name__)

    with app.test_request_context("/?sources=webapp:app-1&sources%5B1%5D=workflow:app-2&sources%5B0%5D=workflow:app-1"):
        assert roster_controller._query_values("sources", "source") == [
            "webapp:app-1",
            "workflow:app-1",
            "workflow:app-2",
        ]

    with app.test_request_context("/?source%5B0%5D=workflow:app-3"):
        assert roster_controller._query_values("sources", "source") == ["workflow:app-3"]


def _app_detail_obj(**overrides: object) -> App:
    data: dict[str, object] = {
        "id": "app-1",
        "tenant_id": "tenant-1",
        "name": "Iris",
        "description": "Agent app",
        "mode": AppMode.AGENT,
        "icon_type": "emoji",
        "icon": "robot",
        "icon_background": "#fff",
        "enable_site": False,
        "enable_api": False,
        "tracing": None,
        "use_icon_as_answer_icon": False,
        "created_by": "account-1",
        "created_at": datetime(2025, 1, 1),
        "updated_by": "account-1",
        "updated_at": datetime(2025, 1, 1),
        "max_active_requests": 0,
    }
    overrides.pop("bound_agent_id", None)
    data.update(overrides)
    data["icon_type"] = IconType(data["icon_type"])
    app = App()
    for key, value in data.items():
        setattr(app, key, value)
    return app


def _account(*, account_id: str = "account-1", privileged: bool = False, timezone: str | None = None) -> Account:
    return make_account(
        account_id=account_id,
        name="Agent Controller Tester",
        email=f"{account_id}@example.com",
        timezone=timezone,
        role=TenantAccountRole.OWNER if privileged else None,
    )


def _candidates_response(variant: str) -> dict[str, object]:
    return {
        "variant": variant,
        "allowed_node_job_candidates": {},
        "allowed_soul_candidates": {},
        "capabilities": {"human_roster_available": False},
    }


def test_agent_v2_console_routes_are_agent_id_first() -> None:
    paths = {route for item in console_ns.resources for route in item.urls}
    for route in (
        "/agent",
        "/agent/<uuid:agent_id>",
        "/agent/<uuid:agent_id>/composer",
        "/agent/<uuid:agent_id>/composer/validate",
        "/agent/<uuid:agent_id>/composer/candidates",
        "/agent/<uuid:agent_id>/features",
        "/agent/<uuid:agent_id>/copy",
        "/agent/<uuid:agent_id>/publish",
        "/agent/<uuid:agent_id>/build-draft/checkout",
        "/agent/<uuid:agent_id>/build-draft",
        "/agent/<uuid:agent_id>/build-draft/apply",
        "/agent/<uuid:agent_id>/referencing-workflows",
        "/agent/<uuid:agent_id>/sandbox/files",
        "/agent/<uuid:agent_id>/api-access",
        "/agent/<uuid:agent_id>/api-enable",
        "/agent/<uuid:agent_id>/api-keys",
        "/agent/<uuid:agent_id>/api-keys/<uuid:api_key_id>",
        "/agent/<uuid:agent_id>/debug-conversation/refresh",
        "/agent/<uuid:agent_id>/chat-messages",
        "/agent/<uuid:agent_id>/chat-messages/<string:task_id>/stop",
        "/agent/<uuid:agent_id>/feedbacks",
        "/agent/<uuid:agent_id>/chat-messages/<uuid:message_id>/suggested-questions",
        "/agent/<uuid:agent_id>/messages/<uuid:message_id>",
        "/agent/<uuid:agent_id>/logs",
        "/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages",
        "/agent/<uuid:agent_id>/log-sources",
        "/agent/<uuid:agent_id>/statistics/summary",
        "/agent/<uuid:agent_id>/versions",
        "/agent/<uuid:agent_id>/versions/<uuid:version_id>",
        "/agent/<uuid:agent_id>/versions/<uuid:version_id>/restore",
        "/agent/invite-options",
    ):
        assert route in paths
    for route in (
        "/agents",
        "/agents/invite-options",
        "/agents/<uuid:agent_id>",
        "/agents/<uuid:agent_id>/versions",
        "/apps/<uuid:app_id>/agent-composer",
        "/apps/<uuid:app_id>/agent-composer/validate",
        "/apps/<uuid:app_id>/agent-composer/candidates",
        "/apps/<uuid:app_id>/agent-features",
        "/apps/<uuid:app_id>/agent-referencing-workflows",
        "/apps/<uuid:app_id>/agent-sandbox/files",
        "/apps/<uuid:agent_id>/api-access",
    ):
        assert route not in paths


def test_agent_app_write_routes_do_not_reuse_app_billing_quota() -> None:
    for route_class in (AgentAppListApi, AgentAppCopyApi):
        assert '@cloud_edition_billing_resource_check("apps")' not in getsource(route_class)


def test_agent_list_reads_do_not_require_workspace_preview() -> None:
    for route_class in (AgentAppListApi, AgentInviteOptionsApi):
        assert "RBACPermission.AGENT_PREVIEW, Workspace()" not in getsource(route_class.get)


def test_agent_app_permission_keys_are_required_response_fields() -> None:
    assert roster_controller.AgentAppPartial.model_fields["permission_keys"].is_required()
    assert roster_controller.AgentAppDetailWithSite.model_fields["permission_keys"].is_required()


@pytest.fixture
def account_id() -> str:
    return "account-1"


def test_agent_app_create_payload_allows_optional_role() -> None:
    omitted = roster_controller.AgentAppCreatePayload.model_validate(
        {"name": "Iris", "description": "Agent app", "icon_type": "emoji", "icon": "robot"}
    )
    blank = roster_controller.AgentAppCreatePayload.model_validate(
        {"name": "Iris", "description": "Agent app", "role": "   ", "icon_type": "emoji", "icon": "robot"}
    )
    assert omitted.role is None
    assert blank.role == ""


def test_agent_chat_stream_preflight_raises_first_error_event() -> None:
    class ClosableStream:
        def __init__(self) -> None:
            self.closed = False
            self._chunks = iter(
                [
                    "event: ping\n\n",
                    (
                        'data: {"event":"error","message":"Incorrect API key provided",'
                        '"code":"completion_request_error","status":400}\n\n'
                    ),
                ]
            )

        def __iter__(self) -> Self:
            return self

        def __next__(self) -> str:
            return next(self._chunks)

        def close(self) -> None:
            self.closed = True

    stream = ClosableStream()
    with pytest.raises(CompletionRequestError) as exc_info:
        completion_controller._raise_agent_stream_error_before_response(stream)
    assert exc_info.value.description is not None
    assert "Incorrect API key provided" in exc_info.value.description
    assert stream.closed is True


def test_agent_chat_stream_preflight_preserves_first_normal_event() -> None:
    stream = iter(
        ["event: ping\n\n", 'data: {"event":"message","answer":"hello"}\n\n', 'data: {"event":"message_end"}\n\n']
    )
    wrapped = completion_controller._raise_agent_stream_error_before_response(stream)
    assert list(wrapped) == [
        "event: ping\n\n",
        'data: {"event":"message","answer":"hello"}\n\n',
        'data: {"event":"message_end"}\n\n',
    ]


def test_drain_streaming_generate_response_returns_on_message_end() -> None:
    closed: list[bool] = []

    def generate_response() -> Generator[str]:
        try:
            yield "event: ping\n\n"
            yield 'data: {"event":"message","answer":"working"}\n\n'
            yield 'data: {"event":"message_end","message_id":"msg-1"}\n\n'
        finally:
            closed.append(True)

    # Retain the generator so garbage collection cannot satisfy the cleanup assertion.
    response = generate_response()
    assert completion_controller._drain_streaming_generate_response(response) is None
    assert closed == [True]


def test_drain_streaming_generate_response_maps_error_event() -> None:
    response = (chunk for chunk in ['data: {"event":"error","message":"backend failed"}\n\n'])
    with pytest.raises(CompletionRequestError, match="backend failed"):
        completion_controller._drain_streaming_generate_response(response)


def test_drain_streaming_generate_response_raises_when_stream_ends_early() -> None:
    response = (chunk for chunk in ['data: {"event":"message","answer":"working"}\n\n'])
    with pytest.raises(CompletionRequestError, match="did not complete"):
        completion_controller._drain_streaming_generate_response(response)


@pytest.mark.parametrize(
    ("payload_extra", "expected_draft_type", "expected_start_new"),
    [
        ({}, AgentConfigDraftType.DRAFT, True),
        ({"conversation_id": None}, AgentConfigDraftType.DRAFT, True),
        ({"conversation_id": ""}, AgentConfigDraftType.DRAFT, True),
        (
            {"conversation_id": "00000000-0000-0000-0000-000000000001"},
            AgentConfigDraftType.DRAFT,
            False,
        ),
        ({"draft_type": "debug_build"}, AgentConfigDraftType.DEBUG_BUILD, False),
        (
            {
                "draft_type": "debug_build",
                "conversation_id": "00000000-0000-0000-0000-000000000001",
            },
            AgentConfigDraftType.DEBUG_BUILD,
            False,
        ),
    ],
)
def test_agent_chat_helper_resolves_scoped_conversation_and_forces_streaming(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_id: str,
    payload_extra: dict[str, str | None],
    expected_draft_type: AgentConfigDraftType,
    expected_start_new: bool,
    unbound_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    app_model = _app_detail_obj(id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT)
    current_user = _account(account_id=account_id)
    captured: dict[str, object] = {}

    def generate(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"answer": "ok"}

    def resolve_debug_conversation(**kwargs: object) -> str:
        captured["resolve_debug_conversation"] = kwargs
        return "00000000-0000-0000-0000-000000000001"

    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)
    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        resolve_debug_conversation,
    )
    monkeypatch.setattr(
        completion_controller.helper, "compact_generate_response", lambda response: {"response": response}
    )
    with app.test_request_context(
        json={"inputs": {}, "query": "hello", "response_mode": "streaming", **payload_extra},
        headers={"X-Trace-Id": "trace-1"},
    ):
        result = completion_controller._create_chat_message(
            current_user=current_user, app_model=app_model, session=unbound_session
        )
    assert result == {"response": {"answer": "ok"}}
    assert captured["app_model"] is app_model
    assert captured["user"] is current_user
    assert captured["streaming"] is True
    args = cast(dict[str, object], captured["args"])
    assert args["response_mode"] == "streaming"
    assert args["conversation_id"] == "00000000-0000-0000-0000-000000000001"
    assert args["auto_generate_name"] is False
    assert args["external_trace_id"] == "trace-1"
    resolve_call = cast(dict[str, object], captured["resolve_debug_conversation"])
    assert resolve_call["draft_type"] == expected_draft_type
    assert resolve_call["start_new"] is expected_start_new


def test_agent_chat_helper_ignores_private_exit_intent_payload_key(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_id: str,
    unbound_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    app_model = _app_detail_obj(id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT)
    current_user = _account(account_id=account_id)
    captured: dict[str, object] = {}

    def generate(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"answer": "ok"}

    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)
    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        lambda **kwargs: "debug-conversation-1",
    )
    monkeypatch.setattr(
        completion_controller.helper,
        "compact_generate_response",
        lambda response: {"response": response},
    )

    with app.test_request_context(
        json={
            "inputs": {},
            "query": "hello",
            "response_mode": "streaming",
            "_agent_runtime_exit_intent": "delete",
        }
    ):
        result = completion_controller._create_chat_message(
            current_user=current_user,
            app_model=app_model,
            session=unbound_session,
        )

    assert result == {"response": {"answer": "ok"}}
    assert captured["streaming"] is True
    args = cast(dict[str, object], captured["args"])
    assert args["response_mode"] == "streaming"
    assert args["conversation_id"] == "debug-conversation-1"
    assert "_agent_runtime_exit_intent" not in args


@pytest.mark.parametrize(
    ("payload_extra", "expected_draft_type"),
    [
        ({}, AgentConfigDraftType.DRAFT),
        ({"draft_type": "debug_build"}, AgentConfigDraftType.DEBUG_BUILD),
    ],
)
def test_agent_chat_helper_rejects_foreign_debug_conversation_before_generation(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_id: str,
    payload_extra: dict[str, str],
    expected_draft_type: AgentConfigDraftType,
    unbound_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    app_model = _app_detail_obj(id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT)
    generate = MagicMock()
    resolve_debug_conversation = MagicMock(return_value="owned-conversation")
    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)
    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        resolve_debug_conversation,
    )
    with app.test_request_context(
        json={
            "inputs": {},
            "query": "hello",
            "response_mode": "streaming",
            "conversation_id": "00000000-0000-0000-0000-000000000001",
            **payload_extra,
        }
    ):
        with pytest.raises(NotFound):
            completion_controller._create_chat_message(
                current_tenant_id="tenant-1",
                current_user=_account(account_id=account_id),
                app_model=app_model,
                agent_id="agent-1",
                session=unbound_session,
            )

    resolve_debug_conversation.assert_called_once()
    resolve_call = resolve_debug_conversation.call_args.kwargs
    assert resolve_call["draft_type"] == expected_draft_type
    assert resolve_call["start_new"] is False
    generate.assert_not_called()


def test_resolve_current_user_agent_debug_conversation_uses_agent_or_backing_app(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class FakeRosterService:
        def __init__(self, session: object) -> None:
            calls.append({"session": session})

        def get_or_create_build_conversation(self, **kwargs: object) -> str:
            calls.append({"get_build": kwargs})
            return f"debug-{kwargs['agent_id']}"

        def rotate_preview_conversation(self, **kwargs: object) -> str:
            calls.append({"rotate_preview": kwargs})
            return f"new-{kwargs['agent_id']}"

        def get_current_preview_conversation(self, **kwargs: object) -> str:
            calls.append({"get_preview": kwargs})
            return f"preview-{kwargs['agent_id']}"

        def get_app_backing_agent(self, **kwargs: object) -> object:
            calls.append({"get_app_backing_agent": kwargs})
            return Agent(
                tenant_id="tenant-1",
                name="Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                id="backing-agent",
            )

    monkeypatch.setattr(completion_controller, "AgentRosterService", FakeRosterService)
    explicit_id = completion_controller._resolve_current_user_agent_debug_conversation_id(
        session="session-1",  # type: ignore[arg-type]
        current_tenant_id="tenant-1",
        current_user=_account(),
        app_model=_app_detail_obj(id="app-1"),
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
        start_new=True,
    )
    fallback_id = completion_controller._resolve_current_user_agent_debug_conversation_id(
        session="session-1",  # type: ignore[arg-type]
        current_tenant_id="tenant-1",
        current_user=_account(),
        app_model=_app_detail_obj(id="app-1"),
        agent_id=None,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
    )
    fallback_preview_id = completion_controller._resolve_current_user_agent_debug_conversation_id(
        session="session-1",  # type: ignore[arg-type]
        current_tenant_id="tenant-1",
        current_user=_account(),
        app_model=_app_detail_obj(id="app-1"),
        agent_id=None,
        draft_type=AgentConfigDraftType.DRAFT,
        start_new=True,
    )
    current_preview_id = completion_controller._resolve_current_user_agent_debug_conversation_id(
        session="session-1",  # type: ignore[arg-type]
        current_tenant_id="tenant-1",
        current_user=_account(),
        app_model=_app_detail_obj(id="app-1"),
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DRAFT,
    )
    assert explicit_id == "new-agent-1"
    assert fallback_id == "debug-backing-agent"
    assert fallback_preview_id == "new-backing-agent"
    assert current_preview_id == "preview-agent-1"
    assert calls[1] == {
        "rotate_preview": {
            "tenant_id": "tenant-1",
            "agent_id": "agent-1",
            "account_id": "account-1",
        }
    }
    assert calls[3] == {"get_app_backing_agent": {"tenant_id": "tenant-1", "app_id": "app-1"}}
    assert calls[4] == {
        "get_build": {
            "tenant_id": "tenant-1",
            "agent_id": "backing-agent",
            "account_id": "account-1",
        }
    }
    assert calls[6] == {"get_app_backing_agent": {"tenant_id": "tenant-1", "app_id": "app-1"}}
    assert calls[7] == {
        "rotate_preview": {
            "tenant_id": "tenant-1",
            "agent_id": "backing-agent",
            "account_id": "account-1",
        }
    }
    assert calls[9] == {
        "get_preview": {
            "tenant_id": "tenant-1",
            "agent_id": "agent-1",
            "account_id": "account-1",
        }
    }


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (completion_controller.services.errors.conversation.ConversationNotExistsError(), NotFound),
        (
            completion_controller.services.errors.conversation.ConversationCompletedError(),
            completion_controller.ConversationCompletedError,
        ),
        (
            completion_controller.services.errors.app_model_config.AppModelConfigBrokenError(),
            completion_controller.AppUnavailableError,
        ),
        (
            completion_controller.ProviderTokenNotInitError("not initialized"),
            completion_controller.ProviderNotInitializeError,
        ),
        (completion_controller.QuotaExceededError(), completion_controller.ProviderQuotaExceededError),
        (
            completion_controller.ModelCurrentlyNotSupportError(),
            completion_controller.ProviderModelCurrentlyNotSupportError,
        ),
        (completion_controller.InvokeRateLimitError("rate limited"), completion_controller.InvokeRateLimitHttpError),
        (completion_controller.InvokeError("invoke failed"), completion_controller.CompletionRequestError),
        (RuntimeError("unexpected"), InternalServerError),
    ],
)
def test_agent_chat_helper_maps_generation_errors(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
    unbound_session: Session,
) -> None:
    app_model = _app_detail_obj(id="app-1", mode=AppMode.CHAT)
    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", lambda **_: (_ for _ in ()).throw(error))
    with app.test_request_context(json={"inputs": {}, "query": "hello"}):
        with pytest.raises(expected):
            completion_controller._create_chat_message(
                current_user=_account(), app_model=app_model, session=unbound_session
            )


def test_dify_tool_candidate_response_keeps_granularity_fields() -> None:
    """Both selection granularities must survive the fields-layer model —
    the frontend needs granularity/tools_count to render the Tools menu."""
    from fields.agent_fields import AgentComposerDifyToolCandidateResponse

    provider_entry = AgentComposerDifyToolCandidateResponse.model_validate(
        {
            "id": "duckduckgo/*",
            "granularity": "provider",
            "name": "DuckDuckGo",
            "provider": "duckduckgo",
            "plugin_id": "langgenius/duckduckgo",
            "tools_count": 2,
        }
    ).model_dump(exclude_none=True)
    assert provider_entry["granularity"] == "provider"
    assert provider_entry["tools_count"] == 2
