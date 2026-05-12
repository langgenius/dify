"""
Tests for core.trigger.provider.PluginTriggerProviderController.

Covers: to_api_entity creation-method logic, credential validation pipeline,
schema resolution by type, event lookup, dispatch/invoke/subscribe delegation.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import (
    EventParameter,
    EventParameterType,
    OAuthSchema,
    TriggerCreationMethod,
)
from core.trigger.errors import TriggerProviderCredentialValidationError
from tests.unit_tests.core.trigger.conftest import (
    i18n,
    make_constructor,
    make_controller,
    make_event,
    make_provider_config,
    make_provider_entity,
    make_subscription,
)

ICON_URL = "https://cdn/icon.png"


class TestToApiEntity:
    @patch("core.trigger.provider.PluginService")
    def test_includes_icons_when_present(self, mock_plugin_svc):
        mock_plugin_svc.get_plugin_icon_url.return_value = ICON_URL
        ctrl = make_controller(entity=make_provider_entity(icon="icon.png", icon_dark="dark.png"))

        api = ctrl.to_api_entity()

        assert api.icon == ICON_URL
        assert api.icon_dark == ICON_URL

    @patch("core.trigger.provider.PluginService")
    def test_icons_none_when_absent(self, mock_plugin_svc):
        ctrl = make_controller(entity=make_provider_entity(icon=None, icon_dark=None))

        api = ctrl.to_api_entity()

        assert api.icon is None
        assert api.icon_dark is None
        mock_plugin_svc.get_plugin_icon_url.assert_not_called()

    @patch("core.trigger.provider.PluginService")
    def test_manual_only_without_schemas(self, mock_plugin_svc):
        mock_plugin_svc.get_plugin_icon_url.return_value = ICON_URL
        ctrl = make_controller(entity=make_provider_entity(constructor=None))

        api = ctrl.to_api_entity()

        assert api.supported_creation_methods == [TriggerCreationMethod.MANUAL]

    @patch("core.trigger.provider.PluginService")
    def test_adds_oauth_when_oauth_schema_present(self, mock_plugin_svc):
        mock_plugin_svc.get_plugin_icon_url.return_value = ICON_URL
        oauth = OAuthSchema(client_schema=[], credentials_schema=[])
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(oauth_schema=oauth)))

        api = ctrl.to_api_entity()

        assert TriggerCreationMethod.OAUTH in api.supported_creation_methods
        assert TriggerCreationMethod.MANUAL in api.supported_creation_methods

    @patch("core.trigger.provider.PluginService")
    def test_adds_apikey_when_credentials_schema_present(self, mock_plugin_svc):
        mock_plugin_svc.get_plugin_icon_url.return_value = ICON_URL
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[make_provider_config()]))
        )

        api = ctrl.to_api_entity()

        assert TriggerCreationMethod.APIKEY in api.supported_creation_methods


class TestGetEvent:
    def test_returns_matching_event(self):
        evt = make_event("push")
        ctrl = make_controller(entity=make_provider_entity(events=[evt, make_event("pr")]))

        assert ctrl.get_event("push") is evt

    def test_returns_none_for_unknown(self):
        ctrl = make_controller(entity=make_provider_entity(events=[make_event("push")]))

        assert ctrl.get_event("nonexistent") is None


class TestGetSubscriptionDefaultProperties:
    def test_returns_defaults_skipping_none(self):
        config1 = make_provider_config("key1")
        config1.default = "val1"
        config2 = make_provider_config("key2")
        config2.default = None
        ctrl = make_controller(entity=make_provider_entity(subscription_schema=[config1, config2]))

        props = ctrl.get_subscription_default_properties()

        assert props == {"key1": "val1"}


class TestValidateCredentials:
    def test_raises_when_no_constructor(self):
        ctrl = make_controller(entity=make_provider_entity(constructor=None))

        with pytest.raises(ValueError, match="Subscription constructor not found"):
            ctrl.validate_credentials("u1", {"key": "val"})

    def test_raises_for_missing_required_field(self):
        required_cfg = make_provider_config("api_key", required=True)
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[required_cfg]))
        )

        with pytest.raises(TriggerProviderCredentialValidationError, match="Missing required"):
            ctrl.validate_credentials("u1", {})

    @patch("core.trigger.provider.PluginTriggerClient")
    def test_passes_with_valid_credentials(self, mock_client):
        required_cfg = make_provider_config("api_key", required=True)
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[required_cfg]))
        )
        mock_client.return_value.validate_provider_credentials.return_value = True

        ctrl.validate_credentials("u1", {"api_key": "secret123"})  # should not raise

    @patch("core.trigger.provider.PluginTriggerClient")
    def test_raises_when_plugin_rejects(self, mock_client):
        required_cfg = make_provider_config("api_key", required=True)
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[required_cfg]))
        )
        mock_client.return_value.validate_provider_credentials.return_value = None

        with pytest.raises(TriggerProviderCredentialValidationError, match="Invalid credentials"):
            ctrl.validate_credentials("u1", {"api_key": "bad"})


class TestGetSupportedCredentialTypes:
    def test_empty_when_no_constructor(self):
        ctrl = make_controller(entity=make_provider_entity(constructor=None))
        assert ctrl.get_supported_credential_types() == []

    def test_oauth_only(self):
        oauth = OAuthSchema(client_schema=[], credentials_schema=[])
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(oauth_schema=oauth)))

        types = ctrl.get_supported_credential_types()

        assert CredentialType.OAUTH2 in types
        assert CredentialType.API_KEY not in types

    def test_apikey_only(self):
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[make_provider_config()]))
        )

        types = ctrl.get_supported_credential_types()

        assert CredentialType.API_KEY in types
        assert CredentialType.OAUTH2 not in types

    def test_both(self):
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
    def test_returns_empty_when_no_constructor(self):
        ctrl = make_controller(entity=make_provider_entity(constructor=None))
        assert ctrl.get_credentials_schema(CredentialType.API_KEY) == []

    def test_returns_apikey_credentials(self):
        cfg = make_provider_config("token")
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(credentials_schema=[cfg])))

        result = ctrl.get_credentials_schema(CredentialType.API_KEY)

        assert len(result) == 1
        assert result[0].name == "token"

    def test_returns_oauth_credentials(self):
        oauth_cred = make_provider_config("oauth_token")
        oauth = OAuthSchema(client_schema=[], credentials_schema=[oauth_cred])
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor(oauth_schema=oauth)))

        result = ctrl.get_credentials_schema(CredentialType.OAUTH2)

        assert len(result) == 1
        assert result[0].name == "oauth_token"

    def test_unauthorized_returns_empty(self):
        ctrl = make_controller(
            entity=make_provider_entity(constructor=make_constructor(credentials_schema=[make_provider_config()]))
        )
        assert ctrl.get_credentials_schema(CredentialType.UNAUTHORIZED) == []

    def test_invalid_type_raises(self):
        ctrl = make_controller(entity=make_provider_entity(constructor=make_constructor()))
        with pytest.raises(ValueError, match="Invalid credential type"):
            ctrl.get_credentials_schema("bogus_type")


class TestGetEventParameters:
    def test_returns_params_for_known_event(self):
        param = EventParameter(name="branch", label=i18n("branch"), type=EventParameterType.STRING)
        evt = make_event("push", parameters=[param])
        ctrl = make_controller(entity=make_provider_entity(events=[evt]))

        result = ctrl.get_event_parameters("push")

        assert "branch" in result
        assert result["branch"].name == "branch"

    def test_returns_empty_for_unknown_event(self):
        ctrl = make_controller(entity=make_provider_entity(events=[make_event("push")]))

        assert ctrl.get_event_parameters("nonexistent") == {}


class TestDispatch:
    @patch("core.trigger.provider.PluginTriggerClient")
    def test_delegates_to_client(self, mock_client):
        ctrl = make_controller()
        expected = MagicMock()
        mock_client.return_value.dispatch_event.return_value = expected

        result = ctrl.dispatch(
            request=MagicMock(),
            subscription=make_subscription(),
            credentials={"k": "v"},
            credential_type=CredentialType.API_KEY,
        )

        assert result is expected
        mock_client.return_value.dispatch_event.assert_called_once()


class TestInvokeTriggerEvent:
    @patch("core.trigger.provider.PluginTriggerClient")
    def test_delegates_to_client(self, mock_client):
        ctrl = make_controller()
        expected = MagicMock()
        mock_client.return_value.invoke_trigger_event.return_value = expected

        result = ctrl.invoke_trigger_event(
            user_id="u1",
            event_name="push",
            parameters={},
            credentials={},
            credential_type=CredentialType.API_KEY,
            subscription=make_subscription(),
            request=MagicMock(),
            payload={},
        )

        assert result is expected


class TestSubscribeTrigger:
    @patch("core.trigger.provider.PluginTriggerClient")
    def test_returns_validated_subscription(self, mock_client):
        ctrl = make_controller()
        mock_client.return_value.subscribe.return_value.subscription = {
            "expires_at": 123,
            "endpoint": "https://e",
            "properties": {},
        }

        result = ctrl.subscribe_trigger(
            user_id="u1",
            endpoint="https://e",
            parameters={},
            credentials={},
            credential_type=CredentialType.API_KEY,
        )

        assert result.endpoint == "https://e"


class TestUnsubscribeTrigger:
    @patch("core.trigger.provider.PluginTriggerClient")
    def test_returns_validated_result(self, mock_client):
        ctrl = make_controller()
        mock_client.return_value.unsubscribe.return_value.subscription = {"success": True, "message": "ok"}

        result = ctrl.unsubscribe_trigger(
            user_id="u1",
            subscription=make_subscription(),
            credentials={},
            credential_type=CredentialType.API_KEY,
        )

        assert result.success is True


class TestRefreshTrigger:
    @patch("core.trigger.provider.PluginTriggerClient")
    def test_uses_system_user_id(self, mock_client):
        ctrl = make_controller()
        mock_client.return_value.refresh.return_value.subscription = {
            "expires_at": 456,
            "endpoint": "https://e",
            "properties": {},
        }

        ctrl.refresh_trigger(subscription=make_subscription(), credentials={}, credential_type=CredentialType.API_KEY)

        call_kwargs = mock_client.return_value.refresh.call_args[1]
        assert call_kwargs["user_id"] == "system"
