"""Shared factory helpers for core.trigger test suite."""

from __future__ import annotations

from typing import Any

from core.entities.provider_entities import ProviderConfig
from core.tools.entities.common_entities import I18nObject
from core.trigger.entities.entities import (
    EventEntity,
    EventIdentity,
    EventParameter,
    OAuthSchema,
    Subscription,
    SubscriptionConstructor,
    TriggerProviderEntity,
    TriggerProviderIdentity,
)
from core.trigger.provider import PluginTriggerProviderController
from models.provider_ids import TriggerProviderID

# Valid format for TriggerProviderID: org/plugin/provider
VALID_PROVIDER_ID = "testorg/testplugin/testprovider"


def i18n(text: str = "test") -> I18nObject:
    return I18nObject(en_US=text, zh_Hans=text)


def make_event(name: str = "test_event", parameters: list[EventParameter] | None = None) -> EventEntity:
    return EventEntity(
        identity=EventIdentity(author="a", name=name, label=i18n(name)),
        description=i18n(name),
        parameters=parameters or [],
    )


def make_provider_entity(
    name: str = "test_provider",
    events: list[EventEntity] | None = None,
    constructor: SubscriptionConstructor | None = None,
    subscription_schema: list[ProviderConfig] | None = None,
    icon: str | None = "icon.png",
    icon_dark: str | None = None,
) -> TriggerProviderEntity:
    return TriggerProviderEntity(
        identity=TriggerProviderIdentity(
            author="a",
            name=name,
            label=i18n(name),
            description=i18n(name),
            icon=icon,
            icon_dark=icon_dark,
        ),
        events=events if events is not None else [make_event()],
        subscription_constructor=constructor,
        subscription_schema=subscription_schema or [],
    )


def make_controller(
    entity: TriggerProviderEntity | None = None,
    tenant_id: str = "tenant-1",
    provider_id: str = VALID_PROVIDER_ID,
) -> PluginTriggerProviderController:
    return PluginTriggerProviderController(
        entity=entity or make_provider_entity(),
        plugin_id="plugin-1",
        plugin_unique_identifier="uid-1",
        provider_id=TriggerProviderID(provider_id),
        tenant_id=tenant_id,
    )


def make_subscription(**overrides: Any) -> Subscription:
    defaults = {"expires_at": 9999999999, "endpoint": "https://hook.test", "properties": {"k": "v"}, "parameters": {}}
    defaults.update(overrides)
    return Subscription(**defaults)


def make_provider_config(
    name: str = "api_key", required: bool = True, config_type: str = "secret-input"
) -> ProviderConfig:
    return ProviderConfig(name=name, label=i18n(name), type=config_type, required=required)


def make_constructor(
    credentials_schema: list[ProviderConfig] | None = None,
    oauth_schema: OAuthSchema | None = None,
) -> SubscriptionConstructor:
    return SubscriptionConstructor(
        parameters=[], credentials_schema=credentials_schema or [], oauth_schema=oauth_schema
    )
