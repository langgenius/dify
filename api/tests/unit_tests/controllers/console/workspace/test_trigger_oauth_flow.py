"""Real HTTP admission and persisted OAuth clients; plugin/cache/builder ports are local."""

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from http import HTTPStatus
from http.cookies import SimpleCookie
from uuid import uuid4

import pytest
from pydantic import TypeAdapter
from werkzeug.test import TestResponse

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import SubscriptionBuilderApiEntity
from extensions.ext_application_services import application_services
from models.account import TenantAccountRole
from models.provider_ids import TriggerProviderID
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.trigger.oauth_service import (
    TriggerOAuthCallbackRequest,
    TriggerOAuthContext,
    TriggerOAuthContextError,
    TriggerOAuthCredentials,
    TriggerOAuthProviderError,
    TriggerOAuthService,
)
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness

_AUTHORIZE = f"/console/api/workspaces/current/trigger-provider/{_PROVIDER}/subscriptions/oauth/authorize"
_CALLBACK = f"/console/api/oauth/plugin/{_PROVIDER}/trigger/callback"
_REDIRECT_URI = f"https://console.example.test{_CALLBACK}"


@dataclass(frozen=True)
class _PluginCall:
    tenant_id: str
    user_id: str
    provider_id: str
    redirect_uri: str
    client_config: PluginOAuthClientConfig


@dataclass
class _PluginOAuth:
    harness: _Harness
    authorizations: list[_PluginCall] = field(default_factory=list)
    exchanges: list[tuple[_PluginCall, TriggerOAuthCallbackRequest]] = field(default_factory=list)
    credentials: Mapping[str, object] = field(default_factory=lambda: {"access_token": "provider-access-token"})
    fail_authorization: bool = False
    fail_exchange: bool = False

    def authorization_url(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        redirect_uri: str,
        client_config: PluginOAuthClientConfig,
    ) -> str:
        assert all(not session.in_transaction() for session in self.harness.metadata.sessions)
        self.authorizations.append(_PluginCall(tenant_id, user_id, str(provider_id), redirect_uri, client_config))
        if self.fail_authorization:
            raise TriggerOAuthProviderError("The provider could not start authorization")
        return "https://provider.example.test/oauth/authorize?client_id=test-client"

    def exchange_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        redirect_uri: str,
        client_config: PluginOAuthClientConfig,
        callback: TriggerOAuthCallbackRequest,
    ) -> TriggerOAuthCredentials:
        assert all(not session.in_transaction() for session in self.harness.metadata.sessions)
        self.exchanges.append(
            (_PluginCall(tenant_id, user_id, str(provider_id), redirect_uri, client_config), callback)
        )
        if self.fail_exchange:
            raise TriggerOAuthProviderError("The provider could not exchange credentials")
        return TriggerOAuthCredentials(self.credentials, 1234567890)


@dataclass
class _Contexts:
    """External one-use capability boundary; real Redis expiry is tested separately."""

    max_age: int = 300
    contexts: dict[str, TriggerOAuthContext] = field(default_factory=dict)

    def create(self, context: TriggerOAuthContext) -> str:
        context_id = str(uuid4())
        self.contexts[context_id] = context
        return context_id

    def consume(self, context_id: str) -> TriggerOAuthContext:
        try:
            return self.contexts.pop(context_id)
        except KeyError as exc:
            raise TriggerOAuthContextError("Invalid or expired context_id") from exc


@dataclass
class _Builders:
    created: list[tuple[str, str, str, SubscriptionBuilderApiEntity]] = field(default_factory=list)
    credentials: list[tuple[TriggerOAuthContext, str, Mapping[str, object], int]] = field(default_factory=list)

    def create(self, *, tenant_id: str, user_id: str, provider_id: TriggerProviderID) -> SubscriptionBuilderApiEntity:
        builder = SubscriptionBuilderApiEntity(
            id=str(uuid4()),
            name="GitHub subscription",
            provider=str(provider_id),
            endpoint="subscription-endpoint",
            parameters={},
            properties={},
            credentials={},
            credential_type=CredentialType.OAUTH2,
        )
        self.created.append((tenant_id, user_id, str(provider_id), builder))
        return builder

    def set_credentials(
        self,
        *,
        context: TriggerOAuthContext,
        provider_id: TriggerProviderID,
        credentials: Mapping[str, object],
        expires_at: int,
    ) -> None:
        self.credentials.append((context, str(provider_id), credentials, expires_at))


@dataclass(frozen=True)
class _Flow:
    harness: _Harness
    plugin: _PluginOAuth
    contexts: _Contexts
    builders: _Builders

    def configure(self) -> None:
        response = self.harness.call(
            "POST", payload={"client_params": {"client_id": "test-client", "client_secret": "real-secret"}}
        )
        assert response.status_code == HTTPStatus.OK

    def authorize(self) -> TestResponse:
        return self.harness.call("GET", url=_AUTHORIZE)

    def grant_callback(self, *, provider_id: str = _PROVIDER) -> str:
        provider = TriggerProviderID(provider_id)
        context_id = self.contexts.create(
            TriggerOAuthContext(
                tenant_id=self.harness.tenant_id,
                user_id=self.harness.account_id,
                plugin_id=provider.plugin_id,
                provider=provider.provider_name,
                subscription_builder_id=str(uuid4()),
            )
        )
        self.harness.client.set_cookie("context_id", context_id)
        return context_id


@pytest.fixture
def flow(harness: _Harness) -> _Flow:
    plugin = _PluginOAuth(harness)
    contexts = _Contexts()
    builders = _Builders()
    with harness.app.app_context():
        services = application_services()
        oauth = TriggerOAuthService(
            clients=services.workspaces.trigger_oauth_clients,
            providers=plugin,
            contexts=contexts,
            builders=builders,
        )
        harness.app.extensions["application_services"] = replace(
            services, workspaces=replace(services.workspaces, trigger_oauth=oauth)
        )
    return _Flow(harness, plugin, contexts, builders)


def test_authorize_returns_url_builder_and_http_only_context_cookie(flow: _Flow) -> None:
    flow.configure()

    response = flow.authorize()

    assert response.status_code == HTTPStatus.OK
    assert response.content_type == "application/json"
    builder = flow.builders.created[0][3]
    assert response.get_json() == {
        "authorization_url": "https://provider.example.test/oauth/authorize?client_id=test-client",
        "subscription_builder_id": builder.id,
        "subscription_builder": builder.model_dump(mode="json"),
    }
    cookie = SimpleCookie()
    cookie.load(response.headers["Set-Cookie"])
    context_cookie = cookie["context_id"]
    assert context_cookie["httponly"]
    assert context_cookie["samesite"] == "Lax"
    assert context_cookie["max-age"] == "300"
    assert context_cookie["path"] == "/"
    context = flow.contexts.contexts[context_cookie.value]
    identifier = flow.harness.metadata.provider.plugin_unique_identifier
    assert context == TriggerOAuthContext(
        flow.harness.tenant_id, flow.harness.account_id, "langgenius/github", "github", builder.id, identifier
    )
    assert flow.plugin.authorizations == [
        _PluginCall(
            flow.harness.tenant_id,
            flow.harness.account_id,
            _PROVIDER,
            _REDIRECT_URI,
            PluginOAuthClientConfig(identifier, {"client_id": "test-client", "client_secret": "real-secret"}),
        )
    ]
    assert "real-secret" not in response.get_data(as_text=True)


def test_callback_without_login_preserves_http_input_and_updates_only_context_builder(flow: _Flow) -> None:
    flow.configure()
    assert flow.authorize().status_code == HTTPStatus.OK
    context = next(iter(flow.contexts.contexts.values()))
    callback_path = f"{_CALLBACK}?code=a%2Bb&state=provider-state"

    response = flow.harness.client.get(
        callback_path,
        headers={"X-Provider-Signature": "signature", "Content-Type": "application/octet-stream"},
        data=b"provider-body",
    )

    assert response.status_code == HTTPStatus.FOUND
    assert response.headers["Location"] == "https://console.example.test/oauth-callback"
    assert response.content_type == "text/html; charset=utf-8"
    assert len(flow.plugin.exchanges) == 1
    call, callback = flow.plugin.exchanges[0]
    assert call == flow.plugin.authorizations[0]
    assert callback.method == "GET"
    assert callback.full_path == callback_path
    assert callback.body == b"provider-body"
    assert dict(callback.headers)["X-Provider-Signature"] == "signature"
    assert dict(callback.headers)["Content-Type"] == "application/octet-stream"
    assert flow.builders.credentials == [(context, _PROVIDER, {"access_token": "provider-access-token"}, 1234567890)]
    assert flow.contexts.contexts == {}

    replay = flow.harness.client.get(callback_path)
    assert replay.status_code == HTTPStatus.FORBIDDEN
    assert replay.get_json()["code"] == "trigger_oauth_context_invalid"
    assert len(flow.plugin.exchanges) == 1
    assert len(flow.builders.credentials) == 1


def test_callback_rejects_package_replaced_after_authorization_before_exchange_or_update(flow: _Flow) -> None:
    flow.configure()
    assert flow.authorize().status_code == HTTPStatus.OK
    context = next(iter(flow.contexts.contexts.values()))
    original_identifier = flow.harness.metadata.provider.plugin_unique_identifier
    assert context.plugin_unique_identifier == original_identifier
    flow.harness.metadata.provider.plugin_unique_identifier = "langgenius/github:2.0.0@replacement"

    response = flow.harness.client.get(f"{_CALLBACK}?code=provider-code")

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "trigger_oauth_context_invalid"
    assert response.get_json()["message"] == "Plugin changed during OAuth authorization; restart authorization"
    assert flow.plugin.exchanges == []
    assert flow.builders.credentials == []
    assert flow.contexts.contexts == {}


@pytest.mark.parametrize("identifier_state", ["missing", "none"])
def test_legacy_context_without_package_uses_current_package_for_exchange(flow: _Flow, identifier_state: str) -> None:
    flow.configure()
    payload: dict[str, object] = {
        "tenant_id": flow.harness.tenant_id,
        "user_id": flow.harness.account_id,
        "plugin_id": "langgenius/github",
        "provider": "github",
        "subscription_builder_id": str(uuid4()),
    }
    if identifier_state == "none":
        payload["plugin_unique_identifier"] = None
    context = TypeAdapter(TriggerOAuthContext).validate_python(payload)
    assert context.plugin_unique_identifier is None
    context_id = flow.contexts.create(context)
    flow.harness.client.set_cookie("context_id", context_id)
    current_identifier = "langgenius/github:2.0.0@replacement"
    flow.harness.metadata.provider.plugin_unique_identifier = current_identifier

    response = flow.harness.client.get(f"{_CALLBACK}?code=provider-code")

    assert response.status_code == HTTPStatus.FOUND
    assert len(flow.plugin.exchanges) == 1
    call, _callback = flow.plugin.exchanges[0]
    assert call.client_config == PluginOAuthClientConfig(
        current_identifier, {"client_id": "test-client", "client_secret": "real-secret"}
    )
    assert flow.builders.credentials == [(context, _PROVIDER, {"access_token": "provider-access-token"}, 1234567890)]
    assert flow.contexts.contexts == {}


@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_authorize_keeps_access_for_each_workspace_role(flow: _Flow, role: TenantAccountRole) -> None:
    flow.configure()
    flow.harness.set_role(role)

    assert flow.authorize().status_code == HTTPStatus.OK
    assert len(flow.plugin.authorizations) == 1


def test_authorize_still_requires_login(flow: _Flow) -> None:
    flow.configure()

    response = flow.harness.client.get(_AUTHORIZE)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert flow.plugin.authorizations == []
    assert flow.builders.created == []


@pytest.mark.parametrize("configured_disabled", [False, True])
def test_authorize_without_enabled_client_returns_not_found(flow: _Flow, configured_disabled: bool) -> None:
    if configured_disabled:
        flow.harness.add_client(
            tenant_id=flow.harness.tenant_id, encrypted_params='{"client_id":"disabled"}', enabled=False
        )

    response = flow.authorize()

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    assert "OAuth client" in response.get_json()["message"]
    assert flow.builders.created == []
    assert flow.contexts.contexts == {}
    assert flow.plugin.authorizations == []


def test_callback_configuration_removed_after_authorize_returns_forbidden(flow: _Flow) -> None:
    flow.configure()
    assert flow.authorize().status_code == HTTPStatus.OK
    assert flow.harness.call("DELETE").status_code == HTTPStatus.OK

    response = flow.harness.client.get(_CALLBACK)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "forbidden"
    assert "OAuth client" in response.get_json()["message"]
    assert flow.plugin.exchanges == []
    assert flow.builders.credentials == []


@pytest.mark.parametrize("context_state", ["missing_cookie", "unknown", "expired"])
def test_missing_or_expired_context_fails_before_plugin_or_config_lookup(flow: _Flow, context_state: str) -> None:
    if context_state == "unknown":
        flow.harness.client.set_cookie("context_id", str(uuid4()))
    elif context_state == "expired":
        context_id = flow.grant_callback()
        del flow.contexts.contexts[context_id]

    response = flow.harness.client.get(_CALLBACK)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "trigger_oauth_context_invalid"
    assert flow.harness.metadata.provider_requests == 0
    assert flow.plugin.exchanges == []
    assert flow.builders.credentials == []


@pytest.mark.parametrize("provider", ["another/github/github", "langgenius/github/other"])
def test_context_cannot_authorize_another_plugin_or_provider(flow: _Flow, provider: str) -> None:
    flow.grant_callback(provider_id=provider)

    response = flow.harness.client.get(_CALLBACK)

    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "trigger_oauth_context_invalid"
    assert flow.harness.metadata.provider_requests == 0
    assert flow.contexts.contexts == {}
    assert flow.plugin.exchanges == []
    assert flow.builders.credentials == []


@pytest.mark.parametrize("operation", ["authorize", "callback"])
def test_plugin_failure_has_specific_bad_gateway_error(flow: _Flow, operation: str) -> None:
    flow.configure()
    if operation == "authorize":
        flow.plugin.fail_authorization = True
        response = flow.authorize()
    else:
        flow.grant_callback()
        flow.plugin.fail_exchange = True
        response = flow.harness.client.get(_CALLBACK)

    assert response.status_code == HTTPStatus.BAD_GATEWAY
    assert response.get_json()["code"] == "trigger_oauth_provider_error"
    assert flow.builders.credentials == []


def test_empty_provider_credentials_do_not_complete_builder(flow: _Flow) -> None:
    flow.configure()
    flow.grant_callback()
    flow.plugin.credentials = {}

    response = flow.harness.client.get(_CALLBACK)

    assert response.status_code == HTTPStatus.BAD_GATEWAY
    assert response.get_json()["code"] == "trigger_oauth_provider_error"
    assert flow.builders.credentials == []


@pytest.mark.parametrize("operation", ["authorize", "callback"])
def test_corrupt_persisted_client_is_server_error_instead_of_invalid_request(flow: _Flow, operation: str) -> None:
    flow.harness.add_client(tenant_id=flow.harness.tenant_id, encrypted_params="{broken-json")
    if operation == "authorize":
        response = flow.authorize()
    else:
        flow.grant_callback()
        response = flow.harness.client.get(_CALLBACK)

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json()["code"] == "trigger_oauth_client_config_invalid"
    assert _PROVIDER in response.get_json()["message"]
    assert "{broken-json" not in response.get_data(as_text=True)
    assert flow.plugin.authorizations == []
    assert flow.plugin.exchanges == []
    assert flow.builders.credentials == []
