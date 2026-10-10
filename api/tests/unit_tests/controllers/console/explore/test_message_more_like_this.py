"""More-like-this HTTP failures through real account admission and SQLite services."""

import json
from collections.abc import Iterator
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select, update
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.explore.message import MessageMoreLikeThisApi
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, InstalledApp, Message
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import (
    _Harness,
)
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import (
    harness as installed_app_harness,
)

__all__ = ["installed_app_harness"]


@pytest.fixture
def harness(installed_app_harness: _Harness) -> Iterator[_Harness]:
    """Reuse real console admission while storing separate current and historical config."""
    state = installed_app_harness
    historical = AppModelConfig(
        app_id=state.target.id,
        model=json.dumps({"provider": "langgenius/openai/openai", "name": "old-model", "completion_params": {}}),
    )
    with state.factory.begin() as session:
        session.add(historical)
        session.flush()
        session.execute(update(App).where(App.id == state.target.id).values(mode=AppMode.COMPLETION))
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == state.target.app_model_config_id)
            .values(more_like_this='{"enabled":true}')
        )
        conversation = session.get(Conversation, state.conversation.id)
        assert conversation is not None
        conversation.mode = AppMode.COMPLETION
        conversation.app_model_config_id = historical.id
    api = ExternalApi(state.app)
    api.add_resource(
        MessageMoreLikeThisApi,
        "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/more-like-this",
        endpoint="console.more_like_this",
    )
    yield state
    state.assert_closed()
    with state.factory() as session:
        installation = session.get(InstalledApp, state.installation.id)
        if installation is None:
            assert session.get(App, state.target.id) is None
        else:
            assert installation.last_used_at is None


def _get(
    state: _Harness,
    *,
    installation_id: str | None = None,
    authenticated: bool = True,
    csrf: bool = True,
    query: str = "response_mode=blocking",
) -> TestResponse:
    client = state.app.test_client()
    token = generate_csrf_token(state.account.id)
    headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
    if authenticated:
        headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': state.account.id})}"
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    return client.get(
        f"/installed-apps/{installation_id or state.installation.id}/messages/{state.message.id}"
        f"/more-like-this?{query}",
        headers=headers,
    )


def _error(response: TestResponse, *, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    body = response.get_json()
    assert body["status"] == status
    assert body["code"] == code
    assert isinstance(body["message"], str)
    assert body["message"]


@pytest.mark.parametrize("response_mode", ["blocking", "streaming"])
def test_real_provider_resolution_failure_releases_sessions_without_updating_usage(
    harness: _Harness, response_mode: str
) -> None:
    assert harness.target.tenant_id != harness.installation.tenant_id
    response = _get(harness, query=f"response_mode={response_mode}")
    # The persisted invalid owner provider reaches the actual model resolver;
    # provider discovery and generation are never replaced by test methods.
    _error(response, status=400, code="invalid_param")
    assert response.get_json()["message"] == "Invalid plugin id invalid/provider"
    with harness.factory() as session:
        assert session.scalar(select(func.count()).select_from(Message)) == 1
        historical_model = session.scalar(
            select(AppModelConfig.model).where(
                AppModelConfig.id
                == select(Conversation.app_model_config_id)
                .where(Conversation.id == harness.conversation.id)
                .scalar_subquery()
            )
        )
        assert historical_model is not None
        assert json.loads(historical_model)["completion_params"] == {}


@pytest.mark.parametrize("missing", ["login", "csrf"])
def test_real_login_and_csrf_are_required(harness: _Harness, missing: str) -> None:
    response = _get(harness, authenticated=missing != "login", csrf=missing != "csrf")
    _error(response, status=401, code="unauthorized")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


@pytest.mark.parametrize("query", ["", "response_mode=invalid"])
def test_invalid_response_mode_uses_shared_validation_error(harness: _Harness, query: str) -> None:
    _error(_get(harness, query=query), status=422, code="unprocessable_entity")


@pytest.mark.parametrize("mode", [mode for mode in AppMode if mode != AppMode.COMPLETION])
def test_non_completion_modes_reject_generation(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    _error(_get(harness), status=400, code="not_completion_app")


@pytest.mark.parametrize("missing", ["installation", "workspace", "app"])
def test_missing_or_foreign_installation_is_rejected(harness: _Harness, missing: str) -> None:
    installation_id = harness.installation.id
    if missing == "installation":
        installation_id = str(uuid4())
    else:
        with harness.factory.begin() as session:
            if missing == "workspace":
                session.execute(
                    update(InstalledApp).where(InstalledApp.id == installation_id).values(tenant_id=str(uuid4()))
                )
            else:
                session.execute(delete(App).where(App.id == harness.target.id))
    _error(_get(harness, installation_id=installation_id), status=404, code="installed_app_not_found")


@pytest.mark.parametrize("model", [Message, Conversation])
@pytest.mark.parametrize("field", ["app_id", "from_account_id", "from_source", "from_end_user_id"])
def test_source_requires_complete_account_ownership(
    harness: _Harness, model: type[Message] | type[Conversation], field: str
) -> None:
    record_id = harness.message.id if model is Message else harness.conversation.id
    value = ConversationFromSource.API if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(model).where(model.id == record_id).values({field: value}))
    _error(
        _get(harness),
        status=404 if model is Message else 400,
        code="message_not_found" if model is Message else "app_unavailable",
    )


@pytest.mark.parametrize("missing", ["message", "conversation", "current-config", "historical-config"])
def test_missing_records_keep_resource_specific_errors(harness: _Harness, missing: str) -> None:
    with harness.factory.begin() as session:
        if missing == "message":
            session.execute(delete(Message).where(Message.id == harness.message.id))
        elif missing == "conversation":
            session.execute(delete(Conversation).where(Conversation.id == harness.conversation.id))
        elif missing == "current-config":
            session.execute(delete(AppModelConfig).where(AppModelConfig.id == harness.target.app_model_config_id))
        else:
            session.execute(
                delete(AppModelConfig).where(
                    AppModelConfig.id
                    == select(Conversation.app_model_config_id)
                    .where(Conversation.id == harness.conversation.id)
                    .scalar_subquery()
                )
            )
    status, code = {
        "message": (404, "message_not_found"),
        "conversation": (400, "app_unavailable"),
        "current-config": (403, "app_more_like_this_disabled"),
        "historical-config": (400, "app_unavailable"),
    }[missing]
    _error(_get(harness), status=status, code=code)


@pytest.mark.parametrize("feature", [None, "", "{}", '{"enabled":false}'])
def test_current_feature_policy_rejects_disabled_regeneration(harness: _Harness, feature: str | None) -> None:
    """A null or empty persisted feature is the legacy disabled setting."""
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(more_like_this=feature)
        )
    _error(_get(harness), status=403, code="app_more_like_this_disabled")


@pytest.mark.parametrize(
    ("current", "field", "value"),
    [
        (True, "more_like_this", '{"secret":"private-config-value"'),
        (True, "more_like_this", '["private-config-value"]'),
        (False, "model", '{"secret":"private-config-value"'),
        (False, "model", '["private-config-value"]'),
        (False, "model", '{"completion_params":["private-config-value"]}'),
        (False, "model", None),
    ],
    ids=["feature-json", "feature-shape", "model-json", "model-shape", "parameter-shape", "missing-model"],
)
def test_corrupt_persisted_configuration_returns_app_unavailable(
    harness: _Harness, current: bool, field: str, value: str | None
) -> None:
    """None represents a missing model payload in an existing configuration row."""
    with harness.factory.begin() as session:
        config_id = (
            harness.target.app_model_config_id
            if current
            else session.scalar(
                select(Conversation.app_model_config_id).where(Conversation.id == harness.conversation.id)
            )
        )
        session.execute(update(AppModelConfig).where(AppModelConfig.id == config_id).values({field: value}))
    response = _get(harness)
    _error(response, status=400, code="app_unavailable")
    assert response.get_json()["message"] == "App unavailable, please check your app configurations."
    assert b"private-config-value" not in response.data
