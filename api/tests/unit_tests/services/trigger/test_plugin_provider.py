"""
Tests for services.trigger.plugin_provider.PluginTriggerProvider.

Covers: to_api_entity creation-method logic, credential validation pipeline,
schema resolution by type, event lookup, dispatch/invoke/subscribe delegation.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import EventParameter, EventParameterType, OAuthSchema
from core.trigger.errors import TriggerProviderCredentialValidationError
from services.trigger.builder_entities import TriggerCreationMethod
from tests.unit_tests.services.trigger.provider_test_helpers import (
    i18n,
    make_constructor,
    make_controller,
    make_event,
    make_provider_config,
    make_provider_entity,
)

ICON_URL = "https://console.example.test/console/api/workspaces/current/plugin/icon?tenant_id=tenant-1&filename="


class TestToApiEntity:
    def test_includes_icons_when_present(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(CONSOLE_API_URL="https://console.example.test")
        ctrl = make_controller(entity=make_provider_entity(icon="icon.png", icon_dark="dark.png"))

        api = ctrl.to_api_entity()

        assert api.icon == ICON_URL + "icon.png"
        assert api.icon_dark == ICON_URL + "dark.png"

    def test_icons_none_when_absent(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(icon=None, icon_dark=None))

        api = ctrl.to_api_entity()

        assert api.icon is None
        assert api.icon_dark is None

    def test_manual_only_without_schemas(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(constructor=None))

        api = ctrl.to_api_entity()

        assert api.supported_creation_methods == [TriggerCreationMethod.MANUAL]

    def test_adds_oauth_when_oauth_schema_present(self) -> None:
        oauth = OAuthSchema(client_schema=[], credentials_schema=[])
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(oauth_schema=oauth)))

        api = ctrl.to_api_entity()

        assert TriggerCreationMethod.OAUTH in api.supported_creation_methods
        assert TriggerCreationMethod.MANUAL in api.supported_creation_methods

    def test_adds_apikey_when_credentials_schema_present(self) -> None:
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[make_provider_config()]))
        )

        api = ctrl.to_api_entity()

        assert TriggerCreationMethod.APIKEY in api.supported_creation_methods


class TestGetEvent:
    def test_returns_matching_event(self) -> None:
        evt = make_event("push")
        ctrl = make_controller(entity=make_provider_entity(events=[evt, make_event("pr")]))

        assert ctrl.get_event("push") is evt

    def test_returns_none_for_unknown(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(events=[make_event("push")]))

        assert ctrl.get_event("nonexistent") is None


class TestGetSubscriptionDefaultProperties:
    def test_returns_defaults_skipping_none(self) -> None:
        config1 = make_provider_config("key1")
        config1.default = "val1"
        config2 = make_provider_config("key2")
        config2.default = None
        ctrl = make_controller(entity=make_provider_entity(subscription_schema=[config1, config2]))

        props = ctrl.get_subscription_default_properties()

        assert props == {"key1": "val1"}


class TestValidateCredentials:
    def test_raises_when_no_constructor(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(constructor=None))

        with pytest.raises(ValueError, match="Subscription constructor not found"):
            ctrl.validate_credentials("u1", {"key": "val"})

    def test_raises_for_missing_required_field(self) -> None:
        required_cfg = make_provider_config("api_key", required=True)
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[required_cfg]))
        )

        with pytest.raises(TriggerProviderCredentialValidationError, match="Missing required"):
            ctrl.validate_credentials("u1", {})


class TestGetSupportedCredentialTypes:
    def test_empty_when_no_constructor(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(constructor=None))
        assert ctrl.get_supported_credential_types() == []

    def test_oauth_only(self) -> None:
        oauth = OAuthSchema(client_schema=[], credentials_schema=[])
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(oauth_schema=oauth)))

        types = ctrl.get_supported_credential_types()

        assert CredentialType.OAUTH2 in types
        assert CredentialType.API_KEY not in types

    def test_apikey_only(self) -> None:
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[make_provider_config()]))
        )

        types = ctrl.get_supported_credential_types()

        assert CredentialType.API_KEY in types
        assert CredentialType.OAUTH2 not in types

    def test_both(self) -> None:
        oauth = OAuthSchema(client_schema=[], credentials_schema=[make_provider_config("oauth_secret")])
        ctrl = make_controller(
            entity=make_provider_entity(
                constructor=make_constructor(credentials_schema=[make_provider_config()], oauth_schema=oauth)
            )
        )

        types = ctrl.get_supported_credential_types()

        assert CredentialType.OAUTH2 in types
        assert CredentialType.API_KEY in types


class TestGetCredentialsSchema:
    def test_returns_empty_when_no_constructor(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(constructor=None))
        assert ctrl.get_credentials_schema(CredentialType.API_KEY) == []

    def test_returns_apikey_credentials(self) -> None:
        cfg = make_provider_config("token")
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(credentials_schema=[cfg])))

        result = ctrl.get_credentials_schema(CredentialType.API_KEY)

        assert len(result) == 1
        assert result[0].name == "token"

    def test_returns_oauth_credentials(self) -> None:
        oauth_cred = make_provider_config("oauth_token")
        oauth = OAuthSchema(client_schema=[], credentials_schema=[oauth_cred])
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(oauth_schema=oauth)))

        result = ctrl.get_credentials_schema(CredentialType.OAUTH2)

        assert len(result) == 1
        assert result[0].name == "oauth_token"

    def test_unauthorized_returns_empty(self) -> None:
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[make_provider_config()]))
        )
        assert ctrl.get_credentials_schema(CredentialType.UNAUTHORIZED) == []

    def test_invalid_type_raises(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor()))
        with pytest.raises(ValueError, match="Invalid credential type"):
            ctrl.get_credentials_schema("bogus_type")


class TestGetEventParameters:
    def test_returns_params_for_known_event(self) -> None:
        param = EventParameter(name="branch", label=i18n("branch"), type=EventParameterType.STRING)
        evt = make_event("push", parameters=[param])
        ctrl = make_controller(entity=make_provider_entity(events=[evt]))

        result = ctrl.get_event_parameters("push")

        assert "branch" in result
        assert result["branch"].name == "branch"

    def test_returns_empty_for_unknown_event(self) -> None:
        ctrl = make_controller(entity=make_provider_entity(events=[make_event("push")]))

        assert ctrl.get_event_parameters("nonexistent") == {}
