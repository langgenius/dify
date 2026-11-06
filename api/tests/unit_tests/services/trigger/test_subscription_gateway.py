"""Exercise subscription provider resolution and dispatch through real daemon HTTP."""

from collections.abc import Callable
from contextvars import Context
from functools import partial
from http import HTTPStatus

import pytest

from configs import dify_config
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription
from models.provider_ids import TriggerProviderID
from services.trigger.subscription_gateway import PluginTriggerSubscriptionGateway
from services.trigger.subscription_query_service import TriggerSubscriptionSchemas
from services.trigger.subscription_service import (
    TriggerSubscriptionInvalidError,
    TriggerSubscriptionProviderError,
)
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _IDENTIFIER
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon

_CREDENTIALS = {"token": "provider-secret"}
_ENDPOINT = "https://example.test/triggers/plugin/subscription"


def _prepare(
    harness: _Harness, daemon: _Daemon
) -> tuple[PluginTriggerSubscriptionGateway, Context, TriggerSubscriptionSchemas]:
    declaration = daemon.provider["declaration"]
    assert isinstance(declaration, dict)
    declaration["subscription_constructor"] = {
        "credentials_schema": [{"name": "token", "type": "secret-input", "required": True}],
    }
    declaration["subscription_schema"] = [{"name": "remote_id", "type": "text-input"}]
    gateway = PluginTriggerSubscriptionGateway()
    context = Context()
    schemas = context.run(
        gateway.get_schemas,
        tenant_id=harness.tenant_id,
        provider_id=TriggerProviderID(_PROVIDER),
        credential_type=CredentialType.API_KEY,
    )
    return gateway, context, schemas


def test_one_operation_reuses_provider_for_schema_and_dispatch(harness: _Harness, daemon: _Daemon) -> None:
    gateway, context, schemas = _prepare(harness, daemon)
    assert [field.name for field in schemas.credentials[CredentialType.API_KEY]] == ["token"]
    assert [field.name for field in schemas.properties] == ["remote_id"]
    assert len(daemon.requests) == 1
    assert daemon.requests[0].method == "GET"

    # All calls in one synchronous operation share the manager's context cache;
    # an intervening package replacement does not change schema/dispatch identity.
    daemon.provider["plugin_unique_identifier"] = "langgenius/github:2.0.0@replacement"
    context.run(
        gateway.validate_credentials,
        tenant_id=harness.tenant_id,
        provider_id=TriggerProviderID(_PROVIDER),
        user_id=harness.account_id,
        credentials=_CREDENTIALS,
    )
    created = Subscription(
        expires_at=12345,
        endpoint=_ENDPOINT,
        parameters={"event": "push"},
        properties={"remote_id": "remote-subscription"},
    )
    daemon.response_data = {"subscription": created.model_dump()}
    actual = context.run(
        gateway.subscribe,
        tenant_id=harness.tenant_id,
        provider_id=TriggerProviderID(_PROVIDER),
        user_id=harness.account_id,
        endpoint=_ENDPOINT,
        parameters=created.parameters,
        credentials=_CREDENTIALS,
        credential_type=CredentialType.API_KEY,
    )
    assert actual == created
    daemon.response_data = {"subscription": {"success": True, "message": "removed"}}
    removed = context.run(
        gateway.unsubscribe,
        tenant_id=harness.tenant_id,
        provider_id=TriggerProviderID(_PROVIDER),
        user_id=harness.account_id,
        subscription=actual,
        credentials=_CREDENTIALS,
        credential_type=CredentialType.API_KEY,
    )
    assert removed.success
    assert removed.message == "removed"

    assert [request.method for request in daemon.requests] == ["GET", "POST", "POST", "POST"]
    verify, subscribe, unsubscribe = daemon.requests[1:]
    for request in (verify, subscribe, unsubscribe):
        assert request.headers["X-Plugin-ID"] == "langgenius/github"
        assert request.headers["X-Plugin-Unique-Identifier"] == _IDENTIFIER
        assert request.headers["X-Api-Key"] == dify_config.PLUGIN_DAEMON_KEY
        assert not request.open_transactions
    assert verify.path == f"/plugin/{harness.tenant_id}/dispatch/trigger/validate_credentials"
    assert verify.payload == {
        "user_id": harness.account_id,
        "data": {"provider": "github", "credentials": _CREDENTIALS},
    }
    assert subscribe.path == f"/plugin/{harness.tenant_id}/dispatch/trigger/subscribe"
    assert subscribe.payload == {
        "user_id": harness.account_id,
        "data": {
            "provider": "github",
            "credentials": _CREDENTIALS,
            "credential_type": "api-key",
            "endpoint": _ENDPOINT,
            "parameters": {"event": "push"},
        },
    }
    assert unsubscribe.path == f"/plugin/{harness.tenant_id}/dispatch/trigger/unsubscribe"
    assert unsubscribe.payload == {
        "user_id": harness.account_id,
        "data": {
            "provider": "github",
            "credentials": _CREDENTIALS,
            "credential_type": "api-key",
            "subscription": created.model_dump(),
        },
    }


def test_missing_required_credential_is_invalid_without_dispatch(harness: _Harness, daemon: _Daemon) -> None:
    gateway, context, _ = _prepare(harness, daemon)

    with pytest.raises(TriggerSubscriptionInvalidError, match="Missing required credential field: token"):
        context.run(
            gateway.validate_credentials,
            tenant_id=harness.tenant_id,
            provider_id=TriggerProviderID(_PROVIDER),
            user_id=harness.account_id,
            credentials={},
        )

    assert len(daemon.requests) == 1
    assert daemon.requests[0].method == "GET"


def test_plugin_credential_rejection_is_invalid(harness: _Harness, daemon: _Daemon) -> None:
    gateway, context, _ = _prepare(harness, daemon)
    daemon.response_data = {"result": False}

    with pytest.raises(TriggerSubscriptionInvalidError, match="Invalid credentials"):
        context.run(
            gateway.validate_credentials,
            tenant_id=harness.tenant_id,
            provider_id=TriggerProviderID(_PROVIDER),
            user_id=harness.account_id,
            credentials=_CREDENTIALS,
        )

    assert len(daemon.requests) == 2
    assert daemon.requests[-1].path.endswith("/validate_credentials")


@pytest.mark.parametrize("failure", ["plugin", "invalid-response"])
def test_verification_failures_are_provider_errors_without_exposing_credentials(
    harness: _Harness, daemon: _Daemon, failure: str
) -> None:
    gateway, context, _ = _prepare(harness, daemon)
    if failure == "plugin":
        daemon.response_code = 1
        daemon.response_message = "remote operation failed"
        daemon.response_data = None
    else:
        daemon.response_data = {}

    with pytest.raises(TriggerSubscriptionProviderError) as caught:
        context.run(
            gateway.validate_credentials,
            tenant_id=harness.tenant_id,
            provider_id=TriggerProviderID(_PROVIDER),
            user_id=harness.account_id,
            credentials=_CREDENTIALS,
        )

    assert caught.value.__cause__ is not None
    assert "provider-secret" not in str(caught.value)
    assert len(daemon.requests) == 2


@pytest.mark.parametrize("operation", ["subscribe", "unsubscribe"])
def test_remote_subscription_failures_propagate_for_service_context(
    harness: _Harness, daemon: _Daemon, operation: str
) -> None:
    gateway, context, _ = _prepare(harness, daemon)
    daemon.response_code = 1
    daemon.response_message = "remote operation failed"
    daemon.response_data = None
    commands: dict[str, Callable[[], object]] = {
        "subscribe": partial(
            gateway.subscribe,
            tenant_id=harness.tenant_id,
            provider_id=TriggerProviderID(_PROVIDER),
            user_id=harness.account_id,
            endpoint=_ENDPOINT,
            parameters={},
            credentials=_CREDENTIALS,
            credential_type=CredentialType.API_KEY,
        ),
        "unsubscribe": partial(
            gateway.unsubscribe,
            tenant_id=harness.tenant_id,
            provider_id=TriggerProviderID(_PROVIDER),
            user_id=harness.account_id,
            subscription=Subscription(expires_at=-1, endpoint=_ENDPOINT, properties={}),
            credentials=_CREDENTIALS,
            credential_type=CredentialType.API_KEY,
        ),
    }
    invoke = commands[operation]

    with pytest.raises(ValueError, match="^plugin daemon: remote operation failed, code: 1$"):
        context.run(invoke)

    assert len(daemon.requests) == 2


def test_provider_lookup_failure_is_a_domain_error(harness: _Harness, daemon: _Daemon) -> None:
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    with pytest.raises(TriggerSubscriptionProviderError) as caught:
        _prepare(harness, daemon)

    assert caught.value.__cause__ is not None
    assert len(daemon.requests) == 1
    assert daemon.requests[0].method == "GET"
