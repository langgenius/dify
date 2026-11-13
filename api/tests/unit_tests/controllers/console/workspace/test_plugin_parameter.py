"""Dynamic options run through real admission, SQL and plugin HTTP transport.

Credential decryption and builder lookup use Redis and are covered separately by
container tests. These cases never require the unit suite's global Redis double.
"""

from contextvars import Context
from http import HTTPStatus
from urllib.parse import urlencode
from uuid import uuid4

import pytest
from sqlalchemy import delete

from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from models import TenantAccountJoin
from models.account import TenantAccountRole
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _provider
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon

_URL = "/console/api/workspaces/current/plugin/parameters/dynamic-options"
_PAYLOAD: dict[str, object] = {
    "plugin_id": "langgenius/github",
    "provider": "github",
    "action": "push",
    "parameter": "branch",
}


def _tool_provider(*, credentials: bool = False) -> dict[str, object]:
    provider = _provider()
    declaration = provider["declaration"]
    assert isinstance(declaration, dict)
    declaration.pop("events")
    identity = declaration["identity"]
    assert isinstance(identity, dict)
    identity["tags"] = ["other"]
    if credentials:
        declaration["credentials_schema"] = [
            ProviderConfig(name="token", type=ProviderConfigType.SECRET_INPUT).model_dump(mode="json")
        ]
    return provider


def _options_response(daemon: _Daemon) -> None:
    daemon.response_data = {"options": [{"value": 101, "label": {"en_US": "Branch 101"}, "icon": None}]}


def _url(method: str, *, credential_id: str | None = None) -> str:
    if method == "POST":
        return f"{_URL}-with-credentials"
    params = {**_PAYLOAD, "provider_type": "tool"}
    if credential_id is not None:
        params["credential_id"] = credential_id
    return f"{_URL}?{urlencode(params)}"


def _payload(method: str) -> dict[str, object] | None:
    if method == "POST":
        return {**_PAYLOAD, "credential_id": "subscription-id", "credentials": {}}
    return None


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_options_require_login_before_plugin_io(harness: _Harness, daemon: _Daemon, method: str) -> None:
    response = harness.client.open(_url(method), method=method, json=_payload(method))

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert daemon.requests == []


@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize(
    "role", [TenantAccountRole.EDITOR, TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR]
)
def test_options_require_admin_or_owner_before_plugin_io(
    harness: _Harness, daemon: _Daemon, method: str, role: TenantAccountRole
) -> None:
    harness.set_role(role)

    response = Context().run(harness.call, method, url=_url(method), payload=_payload(method))

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "forbidden"
    assert daemon.requests == []


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_options_require_active_workspace(harness: _Harness, daemon: _Daemon, method: str) -> None:
    with harness.session_factory.begin() as session:
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))

    response = Context().run(harness.call, method, url=_url(method), payload=_payload(method))

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert daemon.requests == []


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_options_validate_input_before_plugin_io(harness: _Harness, daemon: _Daemon, method: str) -> None:
    url = _URL if method == "GET" else _url(method)
    response = Context().run(harness.call, method, url=url, payload={} if method == "POST" else None)

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert daemon.requests == []


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
def test_anonymous_tool_preserves_response_and_dispatch_after_repository_sessions_close(
    harness: _Harness, daemon: _Daemon, role: TenantAccountRole
) -> None:
    harness.set_role(role)
    daemon.provider = _tool_provider()
    _options_response(daemon)

    response = Context().run(harness.call, "GET", url=f"{_url('GET')}&tenant_id={uuid4()}")

    assert response.status_code == HTTPStatus.OK
    assert response.content_type == "application/json"
    assert response.get_json() == {
        "options": [
            {
                "value": "101",
                "label": dict.fromkeys(("en_US", "zh_Hans", "pt_BR", "ja_JP"), "Branch 101"),
                "icon": None,
            }
        ]
    }
    assert len(daemon.requests) == 2
    assert harness.metadata.sessions
    assert all(not request.open_transactions for request in daemon.requests)
    sent = daemon.requests[-1]
    assert sent.path == f"/plugin/{harness.tenant_id}/dispatch/dynamic_select/fetch_parameter_options"
    assert sent.headers["X-Plugin-ID"] == "langgenius/github"
    assert sent.headers["X-Plugin-Unique-Identifier"] == daemon.provider["plugin_unique_identifier"]
    assert sent.payload == {
        "user_id": harness.account_id,
        "data": {
            "provider": "github",
            "provider_action": "push",
            "parameter": "branch",
            "credentials": {},
            "credential_type": "unauthorized",
        },
    }


def test_empty_options_remain_a_successful_array(harness: _Harness, daemon: _Daemon) -> None:
    daemon.provider = _tool_provider()
    daemon.response_data = {"options": []}

    response = Context().run(harness.call, "GET", url=_url("GET"))

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"options": []}


@pytest.mark.parametrize("explicit_credential", [False, True])
def test_missing_tool_credentials_do_not_dispatch(
    harness: _Harness, daemon: _Daemon, explicit_credential: bool
) -> None:
    daemon.provider = _tool_provider(credentials=True)
    credential_id = str(uuid4()) if explicit_credential else None

    response = Context().run(harness.call, "GET", url=_url("GET", credential_id=credential_id))

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert "not found" in response.get_json()["message"]
    assert [request.method for request in daemon.requests] == ["GET"]
    assert not daemon.requests[0].open_transactions


def test_provider_metadata_rejection_keeps_plugin_error_contract(harness: _Harness, daemon: _Daemon) -> None:
    daemon.provider = _tool_provider()
    daemon.status = HTTPStatus.BAD_REQUEST

    response = Context().run(harness.call, "GET", url=_url("GET"))

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "plugin_error"
    assert response.get_json()["message"]
    assert all(not request.open_transactions for request in daemon.requests)


def test_dynamic_option_rejection_preserves_plugin_message(harness: _Harness, daemon: _Daemon) -> None:
    daemon.provider = _tool_provider()
    daemon.response_code = 1
    daemon.response_message = "branch permission denied"
    daemon.response_data = None

    response = Context().run(harness.call, "GET", url=_url("GET"))

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert response.get_json()["message"] == "plugin daemon: branch permission denied, code: 1"
    assert [request.method for request in daemon.requests] == ["GET", "POST"]
    assert all(not request.open_transactions for request in daemon.requests)


def test_package_mismatch_rejects_dispatch_before_sending_credentials(harness: _Harness, daemon: _Daemon) -> None:
    daemon.provider = _tool_provider()
    query = urlencode(
        {**_PAYLOAD, "provider": "langgenius/github/github", "plugin_id": "langgenius/other", "provider_type": "tool"}
    )

    response = Context().run(harness.call, "GET", url=f"{_URL}?{query}")

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert response.get_json()["message"] == "Plugin unique identifier does not match X-Plugin-ID"
    assert [request.method for request in daemon.requests] == ["GET"]
    assert not daemon.requests[0].open_transactions
