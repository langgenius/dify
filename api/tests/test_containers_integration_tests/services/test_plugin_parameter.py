"""Dynamic-option credentials use real Redis, RSA, SQLite and daemon HTTP."""

import json
from collections.abc import Iterator
from contextvars import Context
from datetime import datetime, timedelta
from http import HTTPStatus
from urllib.parse import urlencode
from uuid import uuid4

import pytest
from sqlalchemy import select

from constants import HIDDEN_VALUE
from core.helper.encrypter import encrypt_token
from core.helper.provider_cache import SingletonProviderCredentialsCache
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.utils.encryption import TriggerProviderCredentialsCache
from extensions.ext_redis import redis_client
from models.tools import BuiltinToolProvider
from models.trigger import TriggerSubscription
from tests.test_containers_integration_tests.services import test_trigger_builder_callers
from tests.test_containers_integration_tests.services.test_trigger_subscription_query import _provider_with_secrets
from tests.unit_tests.controllers.console.workspace.test_plugin_parameter import (
    _PAYLOAD,
    _URL,
    _options_response,
    _tool_provider,
)
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription

sqlite_engine = test_trigger_builder_callers.sqlite_engine
sqlite_session_factory = test_trigger_builder_callers.sqlite_session_factory
application_redis = test_trigger_builder_callers.application_redis
harness = test_trigger_builder_callers.harness
daemon = test_trigger_builder_callers.daemon
runtime = test_trigger_builder_callers.runtime


@pytest.fixture(autouse=True)
def credential_cache_cleanup(harness: _Harness) -> Iterator[None]:
    yield
    with harness.session_factory() as session:
        subscription_ids = session.scalars(
            select(TriggerSubscription.id).where(TriggerSubscription.tenant_id == harness.tenant_id)
        ).all()
    keys = [
        SingletonProviderCredentialsCache(
            tenant_id=harness.tenant_id, provider_type="plugin", provider_identity=_PROVIDER
        ).cache_key,
        *[
            TriggerProviderCredentialsCache(
                tenant_id=harness.tenant_id, provider_id=_PROVIDER, credential_id=subscription_id
            ).cache_key
            for subscription_id in subscription_ids
        ],
    ]
    redis_client.delete(*keys)


def _add_tool_credentials(
    harness: _Harness,
    *,
    token: str,
    tenant_id: str | None = None,
    provider: str = _PROVIDER,
    is_default: bool = False,
    created_at: datetime | None = None,
) -> BuiltinToolProvider:
    with harness.app.app_context():
        ciphertext = encrypt_token(harness.tenant_id, token)
    credential = BuiltinToolProvider(
        tenant_id=tenant_id or harness.tenant_id,
        user_id=harness.account_id,
        provider=provider,
        name=token,
        encrypted_credentials=json.dumps({"token": ciphertext}),
        credential_type=CredentialType.API_KEY,
        is_default=is_default,
    )
    if created_at is not None:
        credential.created_at = created_at
    with harness.session_factory.begin() as session:
        session.add(credential)
    return credential


def _get_url(provider_type: str, credential_id: str | None = None) -> str:
    params = {**_PAYLOAD, "provider_type": provider_type}
    if credential_id is not None:
        params["credential_id"] = credential_id
    return f"{_URL}?{urlencode(params)}"


def _assert_dispatch(daemon: _Daemon, harness: _Harness, credentials: dict[str, object]) -> None:
    dispatch = [request for request in daemon.requests if request.method == "POST"]
    assert len(dispatch) == 1
    assert all(not request.open_transactions for request in daemon.requests)
    sent = dispatch[0]
    assert sent.path == f"/plugin/{harness.tenant_id}/dispatch/dynamic_select/fetch_parameter_options"
    assert sent.headers["X-Plugin-ID"] == "langgenius/github"
    assert sent.headers["X-Plugin-Unique-Identifier"] == daemon.provider["plugin_unique_identifier"]
    assert sent.payload == {
        "user_id": harness.account_id,
        "data": {
            "provider": "github",
            "credentials": credentials,
            "credential_type": CredentialType.API_KEY,
            "provider_action": "push",
            "parameter": "branch",
        },
    }


@pytest.mark.parametrize("selection", ["explicit", "default", "oldest"])
def test_tool_credentials_select_owned_record_and_decrypt_after_repository_close(
    harness: _Harness, daemon: _Daemon, selection: str
) -> None:
    daemon.provider = _tool_provider(credentials=True)
    _options_response(daemon)
    now = datetime(2026, 1, 1)
    _add_tool_credentials(harness, token="foreign-tenant", tenant_id=str(uuid4()), is_default=True)
    _add_tool_credentials(harness, token="foreign-provider", provider="langgenius/github/other", is_default=True)
    oldest = _add_tool_credentials(harness, token="oldest", created_at=now)
    newer = _add_tool_credentials(
        harness, token="newer", created_at=now + timedelta(days=1), is_default=selection == "default"
    )
    chosen = oldest if selection == "oldest" else newer

    response = Context().run(harness.call, "GET", url=_get_url("tool", chosen.id if selection == "explicit" else None))

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["options"][0]["value"] == "101"
    _assert_dispatch(daemon, harness, {"token": chosen.name})
    with harness.session_factory() as session:
        saved = session.get(BuiltinToolProvider, chosen.id)
        assert saved is not None
        assert saved.credentials["token"] != chosen.name


@pytest.mark.parametrize("scope", ["tenant", "provider"])
def test_tool_explicit_credential_cannot_fall_back_to_an_owned_record(
    harness: _Harness, daemon: _Daemon, scope: str
) -> None:
    daemon.provider = _tool_provider(credentials=True)
    _add_tool_credentials(harness, token="owned", is_default=True)
    foreign = _add_tool_credentials(
        harness,
        token="foreign",
        tenant_id=str(uuid4()) if scope == "tenant" else None,
        provider="langgenius/github/other" if scope == "provider" else _PROVIDER,
    )

    response = Context().run(harness.call, "GET", url=_get_url("tool", foreign.id))

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert [request.method for request in daemon.requests] == ["GET"]


@pytest.mark.usefixtures("runtime")
@pytest.mark.parametrize("explicit", [False, True])
def test_trigger_credentials_use_owned_subscription_and_package(
    harness: _Harness, daemon: _Daemon, explicit: bool
) -> None:
    daemon.provider = _provider_with_secrets()
    _options_response(daemon)
    _add_subscription(harness, tenant_id=str(uuid4()), credentials={"token": "foreign"})
    _add_subscription(harness, provider_id="langgenius/github/other", credentials={"token": "foreign"})
    ciphertext = encrypt_token(harness.tenant_id, "trigger-secret")
    owned = _add_subscription(harness, credentials={"token": ciphertext})

    response = Context().run(harness.call, "GET", url=_get_url("trigger", owned.id if explicit else None))

    assert response.status_code == HTTPStatus.OK
    _assert_dispatch(daemon, harness, {"token": "trigger-secret"})
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, owned.id)
        assert saved is not None
        assert saved.credentials["token"] == ciphertext


@pytest.mark.usefixtures("runtime")
@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("scope", ["tenant", "provider", "missing"])
def test_trigger_credentials_are_scoped_to_provider_and_workspace(
    harness: _Harness, daemon: _Daemon, method: str, scope: str
) -> None:
    _add_subscription(harness, credentials={"token": "owned"})
    foreign = _add_subscription(
        harness,
        name="candidate",
        tenant_id=str(uuid4()) if scope == "tenant" else None,
        provider_id="langgenius/github/other" if scope == "provider" else _PROVIDER,
    )
    credential_id = str(uuid4()) if scope == "missing" else foreign.id
    response = Context().run(
        harness.call,
        method,
        url=_get_url("trigger", credential_id) if method == "GET" else f"{_URL}-with-credentials",
        payload={**_PAYLOAD, "credential_id": credential_id, "credentials": {}} if method == "POST" else None,
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert "not found" in response.get_json()["message"]
    assert daemon.requests == []


def test_supplied_trigger_credentials_only_replace_hidden_keys_and_never_persist(
    harness: _Harness, daemon: _Daemon
) -> None:
    daemon.provider = _provider_with_secrets()
    _options_response(daemon)
    with harness.app.app_context():
        ciphertext = encrypt_token(harness.tenant_id, "stored-secret")
    stored_credentials = {"token": ciphertext, "username": "old-user", "omitted": "stored-only"}
    owned = _add_subscription(harness, credentials=stored_credentials)
    request_credentials: dict[str, object] = {
        "token": HIDDEN_VALUE,
        "username": "new-user",
        "empty": "",
        "zero": 0,
        "false": False,
        "null": None,
        "unknown_hidden": HIDDEN_VALUE,
    }

    response = Context().run(
        harness.call,
        "POST",
        url=f"{_URL}-with-credentials",
        payload={**_PAYLOAD, "credential_id": owned.id, "credentials": request_credentials},
    )

    assert response.status_code == HTTPStatus.OK
    _assert_dispatch(daemon, harness, {**request_credentials, "token": "stored-secret", "unknown_hidden": None})
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, owned.id)
        assert saved is not None
        assert saved.credentials == stored_credentials
