"""Exercise callback compatibility and the real Redis subscription builder boundary."""

import json
from collections.abc import Iterator
from dataclasses import asdict, dataclass, replace
from threading import Lock
from uuid import uuid4

import pytest
from flask import Flask

import contexts
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.plugin.entities import OAuthSchema
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.common_entities import I18nObject
from core.trigger.entities.api_entities import SubscriptionBuilderApiEntity
from core.trigger.entities.entities import (
    EventParameter,
    EventParameterType,
    SubscriptionBuilder,
    SubscriptionConstructor,
    TriggerProviderEntity,
    TriggerProviderIdentity,
)
from core.trigger.provider import PluginTriggerProviderController
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from models.provider_ids import TriggerProviderID
from repositories.trigger.subscription_builder_repository import RedisTriggerSubscriptionBuilderRepository
from services.plugin.oauth_service import OAuthProxyService
from services.trigger.oauth_gateway import OAuthProxyContextGateway, TriggerOAuthBuilderGateway
from services.trigger.oauth_service import TriggerOAuthContext, TriggerOAuthContextError

_PROVIDER_ID = TriggerProviderID("langgenius/github/github")
_PLUGIN_IDENTIFIER = "langgenius/github:0.1.0@package-hash"


def _context() -> TriggerOAuthContext:
    return TriggerOAuthContext(
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        plugin_id="langgenius/github",
        provider="github",
        subscription_builder_id=str(uuid4()),
    )


def test_new_context_remains_readable_by_legacy_callback(flask_app_with_containers: Flask) -> None:
    gateway = OAuthProxyContextGateway()
    context = replace(_context(), plugin_unique_identifier=_PLUGIN_IDENTIFIER)
    with flask_app_with_containers.app_context():
        context_id = gateway.create(context)
        key = f"{OAuthProxyService.__KEY_PREFIX__}{context_id}"
        try:
            assert 0 < redis_client.ttl(key) <= gateway.max_age == 300
            assert OAuthProxyService.use_proxy_context(context_id) == asdict(context)
            assert redis_client.exists(key) == 0
        finally:
            redis_client.delete(key)


def test_new_context_preserves_package_binding_when_consumed(flask_app_with_containers: Flask) -> None:
    gateway = OAuthProxyContextGateway()
    context = replace(_context(), plugin_unique_identifier=_PLUGIN_IDENTIFIER)
    with flask_app_with_containers.app_context():
        context_id = gateway.create(context)
        key = f"{OAuthProxyService.__KEY_PREFIX__}{context_id}"
        try:
            assert gateway.consume(context_id) == context
            assert redis_client.exists(key) == 0
        finally:
            redis_client.delete(key)


def test_existing_context_is_consumed_once_by_new_callback(flask_app_with_containers: Flask) -> None:
    gateway = OAuthProxyContextGateway()
    context = _context()
    with flask_app_with_containers.app_context():
        context_id = OAuthProxyService.create_proxy_context(
            user_id=context.user_id,
            tenant_id=context.tenant_id,
            plugin_id=context.plugin_id,
            provider=context.provider,
            extra_data={"subscription_builder_id": context.subscription_builder_id},
        )
        key = f"{OAuthProxyService.__KEY_PREFIX__}{context_id}"
        try:
            assert gateway.consume(context_id) == context
            assert redis_client.exists(key) == 0
            with pytest.raises(TriggerOAuthContextError, match="Invalid or expired context_id"):
                gateway.consume(context_id)
        finally:
            redis_client.delete(key)


@dataclass(frozen=True)
class _CreatedBuilder:
    context: TriggerOAuthContext
    response: SubscriptionBuilderApiEntity
    gateway: TriggerOAuthBuilderGateway


def _provider(tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderController:
    label = I18nObject(en_US="GitHub")
    return PluginTriggerProviderController(
        tenant_id=tenant_id,
        provider_id=provider_id,
        plugin_id=provider_id.plugin_id,
        plugin_unique_identifier=_PLUGIN_IDENTIFIER,
        entity=TriggerProviderEntity(
            identity=TriggerProviderIdentity(
                author="langgenius", name=provider_id.provider_name, label=label, description=label
            ),
            subscription_schema=[ProviderConfig(name="repository", type=ProviderConfigType.TEXT_INPUT, default="dify")],
            subscription_constructor=SubscriptionConstructor(
                parameters=[EventParameter(name="event", type=EventParameterType.STRING, label=label, default="push")],
                oauth_schema=OAuthSchema(
                    credentials_schema=[ProviderConfig(name="access_token", type=ProviderConfigType.SECRET_INPUT)]
                ),
            ),
        ),
    )


@pytest.fixture
def created_builder(flask_app_with_containers: Flask) -> Iterator[_CreatedBuilder]:
    tenant_id, user_id = str(uuid4()), str(uuid4())
    # Populate the normal request cache with real controllers. The gateway, builder
    # service, ownership checks, updater and Redis lock/storage all execute normally.
    previous_providers = contexts.plugin_trigger_providers.get({})
    previous_lock = contexts.plugin_trigger_providers_lock.get(Lock())
    contexts.plugin_trigger_providers.set(
        {
            str(provider_id): _provider(tenant_id, provider_id)
            for provider_id in (_PROVIDER_ID, TriggerProviderID("langgenius/github/other"))
        }
    )
    contexts.plugin_trigger_providers_lock.set(Lock())
    try:
        with flask_app_with_containers.app_context():
            gateway = TriggerOAuthBuilderGateway(builders=application_services().workspaces.trigger_builders)
            response = gateway.create(tenant_id=tenant_id, user_id=user_id, provider_id=_PROVIDER_ID)
            context = TriggerOAuthContext(
                tenant_id=tenant_id,
                user_id=user_id,
                plugin_id=_PROVIDER_ID.plugin_id,
                provider=_PROVIDER_ID.provider_name,
                subscription_builder_id=response.id,
                plugin_unique_identifier=_PLUGIN_IDENTIFIER,
            )
            try:
                yield _CreatedBuilder(context=context, response=response, gateway=gateway)
            finally:
                redis_client.delete(RedisTriggerSubscriptionBuilderRepository.encode_cache_key(response.id))
    finally:
        contexts.plugin_trigger_providers.set(previous_providers)
        contexts.plugin_trigger_providers_lock.set(previous_lock)


def _read_builder(builder_id: str) -> SubscriptionBuilder:
    cached = redis_client.get(RedisTriggerSubscriptionBuilderRepository.encode_cache_key(builder_id))
    assert cached is not None
    return SubscriptionBuilder.model_validate_json(cached)


def test_builder_gateway_creates_owned_oauth_builder(created_builder: _CreatedBuilder) -> None:
    context, response = created_builder.context, created_builder.response
    stored = _read_builder(response.id)

    assert stored.id == stored.endpoint_id == context.subscription_builder_id
    assert stored.tenant_id == context.tenant_id
    assert stored.user_id == context.user_id
    assert stored.provider_id == response.provider == str(_PROVIDER_ID)
    assert stored.credential_type == response.credential_type == CredentialType.OAUTH2
    assert stored.credentials == response.credentials == {}
    assert stored.credential_expires_at == -1
    assert stored.parameters == response.parameters == {"event": "push"}
    assert stored.properties == response.properties == {"repository": "dify"}
    assert 0 < redis_client.ttl(RedisTriggerSubscriptionBuilderRepository.encode_cache_key(response.id)) <= 30 * 60


def test_builder_gateway_updates_credentials_and_expiry_only(created_builder: _CreatedBuilder) -> None:
    context = created_builder.context
    before = _read_builder(context.subscription_builder_id)
    credentials = {"access_token": "provider-access-token", "refresh_token": "provider-refresh-token"}

    created_builder.gateway.set_credentials(
        context=context,
        provider_id=_PROVIDER_ID,
        credentials=credentials,
        expires_at=123456,
    )

    assert _read_builder(context.subscription_builder_id) == before.model_copy(
        update={"credentials": credentials, "credential_expires_at": 123456}
    )


@pytest.mark.parametrize("mismatch", ["tenant", "user", "provider", "builder_id"])
def test_builder_gateway_rejects_mismatched_owner_without_updating(
    created_builder: _CreatedBuilder, mismatch: str
) -> None:
    context = created_builder.context
    before = _read_builder(context.subscription_builder_id)
    provider_id = _PROVIDER_ID
    if mismatch == "tenant":
        context = replace(context, tenant_id=str(uuid4()))
    elif mismatch == "user":
        context = replace(context, user_id=str(uuid4()))
    elif mismatch == "provider":
        provider_id = TriggerProviderID("langgenius/github/other")
    else:
        context = replace(context, subscription_builder_id=str(uuid4()))

    with pytest.raises(ValueError, match="not found"):
        created_builder.gateway.set_credentials(
            context=context,
            provider_id=provider_id,
            credentials={"access_token": "must-not-be-stored"},
            expires_at=123456,
        )

    assert _read_builder(before.id) == before


@pytest.mark.parametrize("payload", ["not-json", "[]", json.dumps({"tenant_id": "workspace"})])
def test_invalid_cached_context_raises_domain_error(flask_app_with_containers: Flask, payload: str) -> None:
    context_id = str(uuid4())
    key = f"{OAuthProxyService.__KEY_PREFIX__}{context_id}"
    with flask_app_with_containers.app_context():
        redis_client.setex(key, OAuthProxyContextGateway.max_age, payload)
        try:
            with pytest.raises(TriggerOAuthContextError, match="Invalid or expired context_id"):
                OAuthProxyContextGateway().consume(context_id)
            assert redis_client.exists(key) == 0
        finally:
            redis_client.delete(key)
