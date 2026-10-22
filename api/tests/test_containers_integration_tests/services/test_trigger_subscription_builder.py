"""Real Redis-backed builder HTTP lifecycle, plugin dispatch and subscription persistence."""

from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask, Response, request
from sqlalchemy import select

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import SubscriptionBuilder
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from extensions.ext_application_services import application_services
from extensions.ext_redis import RedisClientWrapper, redis_client
from models.trigger import TriggerSubscription
from repositories.trigger.subscription_builder_repository import RedisTriggerSubscriptionBuilderRepository
from tests.test_containers_integration_tests.services import test_trigger_subscription_query
from tests.test_containers_integration_tests.services.test_trigger_subscription_query import _provider_with_secrets
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _BASE, _Daemon

sqlite_engine = test_trigger_subscription_query.sqlite_engine
sqlite_session_factory = test_trigger_subscription_query.sqlite_session_factory
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


@pytest.fixture
def application_redis(flask_app_with_containers: Flask) -> RedisClientWrapper:
    assert flask_app_with_containers.extensions["redis"] is redis_client
    return redis_client


def _key(builder_id: str) -> str:
    return RedisTriggerSubscriptionBuilderRepository.encode_cache_key(builder_id)


def _stored(builder_id: str) -> SubscriptionBuilder:
    value = redis_client.get(_key(builder_id))
    assert value is not None
    return SubscriptionBuilder.model_validate_json(value)


def _create(harness: _Harness, daemon: _Daemon, credential_type: CredentialType) -> SubscriptionBuilder:
    provider = _provider_with_secrets()
    declaration = provider["declaration"]
    assert isinstance(declaration, dict)
    constructor = declaration["subscription_constructor"]
    assert isinstance(constructor, dict)
    constructor["parameters"] = [{"name": "event", "type": "string", "label": {"en_US": "Event"}, "default": "push"}]
    declaration["subscription_schema"] = [{"name": "repository", "type": "text-input", "default": "dify"}]
    daemon.provider = provider
    response = Context().run(
        harness.call, "POST", url=f"{_BASE}/create", payload={"credential_type": credential_type.value}
    )
    assert response.status_code == HTTPStatus.OK
    body = response.get_json()["subscription_builder"]
    builder = _stored(body["id"])
    assert body == {
        "id": builder.id,
        "name": "",
        "provider": _PROVIDER,
        "endpoint": generate_plugin_trigger_endpoint_url(builder.id),
        "parameters": {"event": "push"},
        "properties": {"repository": "dify"},
        "credentials": {},
        "credential_type": credential_type.value,
    }
    assert (builder.tenant_id, builder.user_id, builder.provider_id) == (
        harness.tenant_id,
        harness.account_id,
        _PROVIDER,
    )
    assert builder.id == builder.endpoint_id
    assert builder.credential_expires_at == builder.expires_at == -1
    assert 0 < redis_client.ttl(_key(builder.id)) <= 1800
    assert all(not sent.open_transactions for sent in daemon.requests)
    return builder


@pytest.mark.parametrize("credential_type", list(CredentialType))
def test_create_and_get_preserve_defaults_and_credential_type(
    harness: _Harness, daemon: _Daemon, credential_type: CredentialType
) -> None:
    builder = _create(harness, daemon, credential_type)

    response = Context().run(harness.call, "GET", url=f"{_BASE}/{builder.id}")

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["parameters"] == {"event": "push"}
    assert response.get_json()["properties"] == {"repository": "dify"}
    assert response.get_json()["credential_type"] == credential_type.value


def test_update_masks_response_and_preserves_credentials_when_not_supplied(harness: _Harness, daemon: _Daemon) -> None:
    builder = _create(harness, daemon, CredentialType.API_KEY)
    first = Context().run(
        harness.call,
        "POST",
        url=f"{_BASE}/update/{builder.id}",
        payload={"name": "Updated", "credentials": {"token": "first-secret"}, "parameters": {"event": "pull"}},
    )
    assert first.status_code == HTTPStatus.OK
    assert first.get_json()["credentials"] == {"token": "fi********et"}
    assert _stored(builder.id).credentials == {"token": "first-secret"}

    second = Context().run(
        harness.call, "POST", url=f"{_BASE}/update/{builder.id}", payload={"properties": {"repository": "other"}}
    )
    assert second.status_code == HTTPStatus.OK
    assert second.get_json()["name"] == "Updated"
    assert second.get_json()["parameters"] == {"event": "pull"}
    assert second.get_json()["properties"] == {"repository": "other"}
    assert second.get_json()["credentials"] == first.get_json()["credentials"]
    assert _stored(builder.id).credentials == {"token": "first-secret"}
    assert 0 < redis_client.ttl(_key(builder.id)) <= 1800


@pytest.mark.parametrize(
    ("field", "operation"),
    [
        ("id", "get"),
        ("tenant_id", "get"),
        ("user_id", "get"),
        ("provider_id", "get"),
        ("endpoint_id", "get"),
        ("user_id", "update"),
        ("tenant_id", "verify-and-update"),
        ("provider_id", "logs"),
        ("user_id", "build"),
    ],
)
def test_all_owned_builder_routes_reject_foreign_capabilities_without_changing_them(
    harness: _Harness, daemon: _Daemon, field: str, operation: str
) -> None:
    builder = _create(harness, daemon, CredentialType.UNAUTHORIZED)
    foreign = builder.model_copy(update={field: "langgenius/github/other" if field == "provider_id" else str(uuid4())})
    redis_client.setex(_key(builder.id), 1800, foreign.model_dump_json())
    path = builder.id if operation == "get" else f"{operation}/{builder.id}"
    method = "GET" if operation in {"get", "logs"} else "POST"

    response = Context().run(harness.call, method, url=f"{_BASE}/{path}", payload={"name": "Must not persist"})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert "not found" in response.get_json()["message"]
    assert _stored(builder.id) == foreign
    assert not any(sent.method == "POST" for sent in daemon.requests)


@pytest.mark.parametrize("operation", ["get", "update", "verify-and-update", "logs", "build"])
def test_missing_builder_does_not_recreate_a_draft(harness: _Harness, daemon: _Daemon, operation: str) -> None:
    builder = _create(harness, daemon, CredentialType.UNAUTHORIZED)
    redis_client.delete(_key(builder.id))
    path = builder.id if operation == "get" else f"{operation}/{builder.id}"
    method = "GET" if operation in {"get", "logs"} else "POST"

    response = Context().run(harness.call, method, url=f"{_BASE}/{path}", payload={"name": "Must not persist"})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "not found" in response.get_json()["message"]
    assert redis_client.get(_key(builder.id)) is None


def test_logs_are_owned_and_keep_only_last_ten_requests(harness: _Harness, daemon: _Daemon) -> None:
    builder = _create(harness, daemon, CredentialType.UNAUTHORIZED)
    with harness.app.app_context():
        service = application_services().workspaces.trigger_builders
        for index in range(12):
            with harness.app.test_request_context(f"/triggers/plugin/{builder.id}", method="POST", data=str(index)):
                service.append_log(builder.id, request, Response(f"response-{index}", status=202))

    response = Context().run(harness.call, "GET", url=f"{_BASE}/logs/{builder.id}")

    assert response.status_code == HTTPStatus.OK
    logs = response.get_json()["logs"]
    assert [log["request"]["data"] for log in logs] == [str(index) for index in range(2, 12)]
    assert [log["response"]["data"] for log in logs] == [f"response-{index}" for index in range(2, 12)]
    assert all(log["endpoint"] == builder.id and log["response"]["status_code"] == 202 for log in logs)
    assert 0 < redis_client.ttl(f"trigger:subscription:builder:logs:{builder.id}") <= 1800


@pytest.mark.parametrize("credentials", [{}, {"token": "oauth-secret"}], ids=["empty", "authorized"])
def test_oauth_verification_depends_on_saved_credentials_without_plugin_invocation(
    harness: _Harness, daemon: _Daemon, credentials: dict[str, str]
) -> None:
    builder = _create(harness, daemon, CredentialType.OAUTH2)

    response = Context().run(
        harness.call, "POST", url=f"{_BASE}/verify-and-update/{builder.id}", payload={"credentials": credentials}
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"verified": bool(credentials)}
    assert _stored(builder.id).credentials == credentials
    assert not any(sent.method == "POST" for sent in daemon.requests)


def test_api_key_verification_dispatches_new_credentials_to_the_owned_provider(
    harness: _Harness, daemon: _Daemon
) -> None:
    builder = _create(harness, daemon, CredentialType.API_KEY)

    response = Context().run(
        harness.call,
        "POST",
        url=f"{_BASE}/verify-and-update/{builder.id}",
        payload={"credentials": {"token": "new-secret"}},
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"verified": True}
    sent = [sent for sent in daemon.requests if sent.method == "POST"]
    assert len(sent) == 1
    assert sent[0].path == f"/plugin/{harness.tenant_id}/dispatch/trigger/validate_credentials"
    assert sent[0].payload == {
        "user_id": harness.account_id,
        "data": {"provider": "github", "credentials": {"token": "new-secret"}},
    }
    assert sent[0].headers["X-Plugin-ID"] == "langgenius/github"
    assert not sent[0].open_transactions
    assert _stored(builder.id).credentials == {"token": "new-secret"}


@pytest.mark.parametrize("credential_type", [CredentialType.UNAUTHORIZED, CredentialType.OAUTH2])
def test_successful_build_persists_owned_subscription_then_removes_builder(
    harness: _Harness, daemon: _Daemon, credential_type: CredentialType
) -> None:
    builder = _create(harness, daemon, credential_type)
    daemon.response_data = {
        "subscription": {
            "endpoint": generate_plugin_trigger_endpoint_url(builder.id),
            "parameters": {"event": "push"},
            "properties": {"repository": "provider-value"},
            "expires_at": 1787560681,
        }
    }

    response = Context().run(harness.call, "POST", url=f"{_BASE}/build/{builder.id}", payload={"name": "Published"})

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    assert redis_client.get(_key(builder.id)) is None
    with harness.session_factory() as session:
        subscription = session.scalar(select(TriggerSubscription).where(TriggerSubscription.id == builder.id))
        assert subscription is not None
        assert subscription.tenant_id == harness.tenant_id
        assert subscription.user_id == harness.account_id
        assert subscription.provider_id == _PROVIDER
        assert subscription.endpoint_id == builder.id
        assert subscription.name == "Published"
        assert subscription.credential_type == credential_type
        assert subscription.parameters == {"event": "push"}
        assert subscription.properties == {
            "repository": "dify" if credential_type == CredentialType.UNAUTHORIZED else "provider-value"
        }
        assert subscription.expires_at == (-1 if credential_type == CredentialType.UNAUTHORIZED else 1787560681)
    assert len([sent for sent in daemon.requests if sent.method == "POST"]) == (
        0 if credential_type == CredentialType.UNAUTHORIZED else 1
    )


def test_failed_plugin_build_preserves_the_updated_draft(harness: _Harness, daemon: _Daemon) -> None:
    builder = _create(harness, daemon, CredentialType.OAUTH2)
    daemon.response_code = 1
    daemon.response_message = "subscription rejected"
    daemon.response_data = None

    response = Context().run(harness.call, "POST", url=f"{_BASE}/build/{builder.id}", payload={"name": "Retry me"})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert response.get_json()["message"] == "plugin daemon: subscription rejected, code: 1"
    assert _stored(builder.id).name == "Retry me"
    with harness.session_factory() as session:
        assert session.scalar(select(TriggerSubscription).where(TriggerSubscription.id == builder.id)) is None
