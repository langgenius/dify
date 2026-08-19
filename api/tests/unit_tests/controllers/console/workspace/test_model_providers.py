from inspect import unwrap
from unittest.mock import ANY, patch

import pytest
from flask import Flask
from pydantic_core import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console.workspace.model_providers import (
    ModelProviderCredentialApi,
    ModelProviderCredentialSwitchApi,
    ModelProviderCreditsApi,
    ModelProviderIconApi,
    ModelProviderListApi,
    ModelProviderPaymentCheckoutUrlApi,
    ModelProviderSummaryListApi,
    ModelProviderValidateApi,
    PreferredProviderTypeUpdateApi,
)
from core.entities.provider_entities import CredentialConfiguration
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from models import Account
from models.provider import ProviderType
from services.entities.model_provider_entities import (
    CustomConfigurationResponse,
    CustomConfigurationStatus,
    ModelProviderCustomConfigurationSummaryResponse,
    ModelProviderPluginSummaryResponse,
    ModelProviderSummaryResponse,
    ModelProviderSystemConfigurationSummaryResponse,
    ProviderResponse,
    SystemConfigurationResponse,
)
from services.workspace_service import EffectiveCreditPool

VALID_UUID = "123e4567-e89b-12d3-a456-426614174000"
INVALID_UUID = "123"


def make_account() -> Account:
    account = Account(name="Provider Owner", email="owner@example.com")
    account.id = "account-1"
    return account


def make_provider_response() -> ProviderResponse:
    return ProviderResponse(
        tenant_id="tenant1",
        provider="openai",
        label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
        description=I18nObject(en_US="OpenAI models", zh_Hans="OpenAI models zh"),
        icon_small=I18nObject(en_US="icon.svg", zh_Hans="icon.svg"),
        icon_small_dark=I18nObject(en_US="icon-dark.svg", zh_Hans="icon-dark.svg"),
        background="#ffffff",
        supported_model_types=[ModelType.LLM, ModelType.TEXT_EMBEDDING],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL, ConfigurateMethod.CUSTOMIZABLE_MODEL],
        preferred_provider_type=ProviderType.CUSTOM,
        custom_configuration=CustomConfigurationResponse(
            status=CustomConfigurationStatus.ACTIVE,
            current_credential_id=VALID_UUID,
            current_credential_name="production",
            available_credentials=[],
            custom_models=[],
            can_added_models=[],
        ),
        system_configuration=SystemConfigurationResponse(
            enabled=True,
            current_quota_type=None,
            quota_configurations=[],
        ),
    )


def expected_provider_payload() -> dict[str, object]:
    icon_url_prefix = f"{dify_config.CONSOLE_API_URL}/console/api/workspaces/tenant1/model-providers/openai"
    return {
        "tenant_id": "tenant1",
        "provider": "openai",
        "label": {"zh_Hans": "OpenAI", "en_US": "OpenAI"},
        "description": {"zh_Hans": "OpenAI models zh", "en_US": "OpenAI models"},
        "icon_small": {
            "zh_Hans": f"{icon_url_prefix}/icon_small/zh_Hans",
            "en_US": f"{icon_url_prefix}/icon_small/en_US",
        },
        "icon_small_dark": {
            "zh_Hans": f"{icon_url_prefix}/icon_small_dark/zh_Hans",
            "en_US": f"{icon_url_prefix}/icon_small_dark/en_US",
        },
        "background": "#ffffff",
        "help": None,
        "supported_model_types": ["llm", "text-embedding"],
        "configurate_methods": ["predefined-model", "customizable-model"],
        "provider_credential_schema": None,
        "model_credential_schema": None,
        "preferred_provider_type": "custom",
        "custom_configuration": {
            "status": "active",
            "current_credential_id": VALID_UUID,
            "current_credential_name": "production",
            "available_credentials": [],
            "custom_models": [],
            "can_added_models": [],
        },
        "system_configuration": {
            "enabled": True,
            "current_quota_type": None,
            "quota_configurations": [],
        },
    }


class TestModelProviderListApi:
    def test_get_success(self, app: Flask):
        api = ModelProviderListApi()
        method = unwrap(api.get)
        provider = make_provider_response()

        with (
            app.test_request_context("/?model_type=llm"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_provider_list",
                return_value=[provider],
            ) as get_provider_list,
        ):
            result = method(api, "tenant1")

        get_provider_list.assert_called_once_with(tenant_id="tenant1", model_type=ModelType.LLM)
        assert result == {"data": [expected_provider_payload()]}

    def test_get_without_model_type_passes_none(self, app: Flask):
        api = ModelProviderListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_provider_list",
                return_value=[],
            ) as get_provider_list,
        ):
            result = method(api, "tenant1")

        get_provider_list.assert_called_once_with(tenant_id="tenant1", model_type=None)
        assert result == {"data": []}


class TestModelProviderSummaryListApi:
    def test_get_success(self, app: Flask):
        api = ModelProviderSummaryListApi()
        method = unwrap(api.get)
        provider = ModelProviderSummaryResponse(
            tenant_id="tenant1",
            provider="langgenius/openai/openai",
            plugin_id="langgenius/openai",
            label=I18nObject(en_US="OpenAI"),
            description=I18nObject(en_US="OpenAI models"),
            icon_small=I18nObject(en_US="icon.svg"),
            icon_small_dark=None,
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            preferred_provider_type=ProviderType.CUSTOM,
            is_configured=True,
            custom_configuration=ModelProviderCustomConfigurationSummaryResponse(
                status=CustomConfigurationStatus.ACTIVE,
                has_custom_models=True,
                available_credentials=[
                    CredentialConfiguration(
                        credential_id=VALID_UUID,
                        credential_name="production",
                    ),
                    CredentialConfiguration(
                        credential_id="223e4567-e89b-12d3-a456-426614174000",
                        credential_name="backup",
                    ),
                ],
                current_credential_id=VALID_UUID,
                current_credential_name="production",
                current_credential_usable=True,
            ),
            system_configuration=ModelProviderSystemConfigurationSummaryResponse(enabled=False),
        )
        plugin = ModelProviderPluginSummaryResponse(
            installation_id="installation-1",
            plugin_id="langgenius/openai",
            plugin_unique_identifier="langgenius/openai:1.0.0@checksum",
            runtime_type="local",
            source="marketplace",
            version="1.0.0",
        )

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_provider_summary_list",
                return_value=([provider], {"langgenius/openai": plugin}),
            ) as get_provider_summary_list,
        ):
            result = method(api, "tenant1")

        get_provider_summary_list.assert_called_once_with(tenant_id="tenant1")
        assert result["data"][0]["provider"] == "langgenius/openai/openai"
        assert "tenant_id" not in result["data"][0]
        assert result["data"][0]["custom_configuration"] == {
            "status": "active",
            "has_custom_models": True,
            "available_credentials": [
                {
                    "credential_id": VALID_UUID,
                    "credential_name": "production",
                },
                {
                    "credential_id": "223e4567-e89b-12d3-a456-426614174000",
                    "credential_name": "backup",
                },
            ],
            "current_credential_id": VALID_UUID,
            "current_credential_name": "production",
            "current_credential_usable": True,
        }
        assert result["plugins"]["langgenius/openai"]["installation_id"] == "installation-1"


class TestModelProviderCreditsApi:
    def test_get_success(self, unbound_session: Session):
        api = ModelProviderCreditsApi()
        method = unwrap(api.get)
        session = unbound_session
        credit_pool = EffectiveCreditPool(
            plan="team",
            pool_type="paid",
            quota_limit=-1,
            quota_used=999,
            next_credit_reset_date=1775001600,
        )

        with patch(
            "controllers.console.workspace.model_providers.WorkspaceService.get_effective_credit_pool",
            return_value=credit_pool,
        ) as get_effective_credit_pool:
            result = method(api, session, "tenant1")

        get_effective_credit_pool.assert_called_once_with("tenant1", session=session)
        assert result == {
            "pool_type": "paid",
            "quota_limit": -1,
            "quota_used": 999,
            "remaining_credits": -1,
            "is_unlimited": True,
            "is_exhausted": False,
            "exhausted_at": None,
            "next_credit_reset_date": 1775001600,
        }

    def test_get_without_effective_pool(self, unbound_session: Session):
        api = ModelProviderCreditsApi()
        method = unwrap(api.get)
        session = unbound_session

        with patch(
            "controllers.console.workspace.model_providers.WorkspaceService.get_effective_credit_pool",
            return_value=EffectiveCreditPool(),
        ):
            result = method(api, session, "tenant1")

        assert result == {
            "pool_type": None,
            "quota_limit": None,
            "quota_used": None,
            "remaining_credits": None,
            "is_unlimited": False,
            "is_exhausted": True,
            "exhausted_at": None,
            "next_credit_reset_date": None,
        }


class TestModelProviderCredentialApi:
    def test_get_success(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.get)

        with (
            app.test_request_context(f"/?credential_id={VALID_UUID}"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_provider_credential",
                return_value={
                    "api_key": "sk-test",
                    "endpoint": "https://api.example.com",
                    "nested": {"region": "us-east-1"},
                },
            ) as get_provider_credential,
        ):
            result = method(api, "tenant1", provider="openai")

        get_provider_credential.assert_called_once_with(
            tenant_id="tenant1", provider="openai", credential_id=VALID_UUID
        )
        assert result == {
            "credentials": {
                "api_key": "sk-test",
                "endpoint": "https://api.example.com",
                "nested": {"region": "us-east-1"},
            }
        }

    def test_get_current_credential_without_id(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_provider_credential",
                return_value=None,
            ) as get_provider_credential,
        ):
            result = method(api, "tenant1", provider="openai")

        get_provider_credential.assert_called_once_with(tenant_id="tenant1", provider="openai", credential_id=None)
        assert result == {"credentials": None}

    def test_get_invalid_uuid(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.get)

        with app.test_request_context(f"/?credential_id={INVALID_UUID}"):
            with pytest.raises(ValidationError):
                method(api, "tenant1", provider="openai")

    def test_post_create_success(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}, "name": "test"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.create_provider_credential",
                return_value=None,
            ) as create_provider_credential,
        ):
            result, status = method(api, "tenant1", provider="openai")

        create_provider_credential.assert_called_once_with(
            tenant_id="tenant1",
            provider="openai",
            credentials={"a": "b"},
            credential_name="test",
        )
        assert result == {"result": "success"}
        assert status == 201

    def test_post_create_validation_error(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.create_provider_credential",
                side_effect=CredentialsValidateFailedError("bad"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, "tenant1", provider="openai")

    def test_put_update_success(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.put)

        payload = {"credential_id": VALID_UUID, "credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.update_provider_credential",
                return_value=None,
            ) as update_provider_credential,
        ):
            result = method(api, "tenant1", provider="openai")

        update_provider_credential.assert_called_once_with(
            tenant_id="tenant1",
            provider="openai",
            credentials={"a": "b"},
            credential_id=VALID_UUID,
            credential_name=None,
        )
        assert result == {"result": "success"}

    def test_put_invalid_uuid(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.put)

        payload = {"credential_id": INVALID_UUID, "credentials": {"a": "b"}}

        with app.test_request_context("/", json=payload):
            with pytest.raises(ValidationError):
                method(api, "tenant1", provider="openai")

    def test_delete_success(self, app: Flask):
        api = ModelProviderCredentialApi()
        method = unwrap(api.delete)

        payload = {"credential_id": VALID_UUID}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.remove_provider_credential",
                return_value=None,
            ) as remove_provider_credential,
        ):
            result, status = method(api, "tenant1", provider="openai")

        remove_provider_credential.assert_called_once_with(
            tenant_id="tenant1", provider="openai", credential_id=VALID_UUID
        )
        assert status == 204
        assert result == ""


class TestModelProviderCredentialSwitchApi:
    def test_switch_success(self, app: Flask):
        api = ModelProviderCredentialSwitchApi()
        method = unwrap(api.post)

        payload = {"credential_id": VALID_UUID}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.switch_active_provider_credential",
                return_value=None,
            ) as switch_active_provider_credential,
        ):
            result = method(api, "tenant1", provider="openai")

        switch_active_provider_credential.assert_called_once_with(
            tenant_id="tenant1",
            provider="openai",
            credential_id=VALID_UUID,
        )
        assert result == {"result": "success"}

    def test_switch_invalid_uuid(self, app: Flask):
        api = ModelProviderCredentialSwitchApi()
        method = unwrap(api.post)

        payload = {"credential_id": INVALID_UUID}

        with app.test_request_context("/", json=payload):
            with pytest.raises(ValidationError):
                method(api, "tenant1", provider="openai")


class TestModelProviderValidateApi:
    def test_validate_success(self, app: Flask):
        api = ModelProviderValidateApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.validate_provider_credentials",
                return_value=None,
            ) as validate_provider_credentials,
        ):
            result = method(api, "tenant1", provider="openai")

        validate_provider_credentials.assert_called_once_with(
            tenant_id="tenant1", provider="openai", credentials={"a": "b"}
        )
        assert result == {"result": "success", "error": None}

    def test_validate_failure(self, app: Flask):
        api = ModelProviderValidateApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.validate_provider_credentials",
                side_effect=CredentialsValidateFailedError("bad"),
            ),
        ):
            result = method(api, "tenant1", provider="openai")

        assert result == {"result": "error", "error": "bad"}


class TestModelProviderIconApi:
    def test_icon_success(self, app: Flask):
        api = ModelProviderIconApi()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_model_provider_icon",
                return_value=(b"123", "image/png"),
            ) as get_model_provider_icon,
        ):
            response = api.get("t1", "openai", "logo", "en")

        get_model_provider_icon.assert_called_once_with(tenant_id="t1", provider="openai", icon_type="logo", lang="en")
        assert response.mimetype == "image/png"
        response.direct_passthrough = False
        assert response.get_data() == b"123"

    def test_icon_not_found(self, app: Flask):
        api = ModelProviderIconApi()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_model_provider_icon",
                return_value=(None, None),
            ),
        ):
            with pytest.raises(ValueError):
                api.get("t1", "openai", "logo", "en")


class TestPreferredProviderTypeUpdateApi:
    def test_update_success(self, app: Flask):
        api = PreferredProviderTypeUpdateApi()
        method = unwrap(api.post)

        payload = {"preferred_provider_type": "custom"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.switch_preferred_provider",
                return_value=None,
            ) as switch_preferred_provider,
        ):
            result = method(api, "tenant1", provider="openai")

        switch_preferred_provider.assert_called_once_with(
            tenant_id="tenant1", provider="openai", preferred_provider_type="custom"
        )
        assert result == {"result": "success"}

    def test_invalid_enum(self, app: Flask):
        api = PreferredProviderTypeUpdateApi()
        method = unwrap(api.post)

        payload = {"preferred_provider_type": "invalid"}

        with app.test_request_context("/", json=payload):
            with pytest.raises(ValidationError):
                method(api, "tenant1", provider="openai")


class TestModelProviderPaymentCheckoutUrlApi:
    def test_checkout_success(self, app: Flask):
        api = ModelProviderPaymentCheckoutUrlApi()
        method = unwrap(api.get)

        user = make_account()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.BillingService.is_tenant_owner_or_admin",
                return_value=None,
            ) as is_tenant_owner_or_admin,
            patch(
                "controllers.console.workspace.model_providers.BillingService.get_model_provider_payment_link",
                return_value={"payment_link": "https://payment.example.com/provider"},
            ) as get_model_provider_payment_link,
        ):
            result = method(api, "tenant1", user, provider="anthropic")

        is_tenant_owner_or_admin.assert_called_once_with(user, session=ANY)
        get_model_provider_payment_link.assert_called_once_with(
            provider_name="anthropic",
            tenant_id="tenant1",
            account_id="account-1",
            prefilled_email="owner@example.com",
        )
        assert result == {"payment_link": "https://payment.example.com/provider"}

    def test_invalid_provider(self, app: Flask):
        api = ModelProviderPaymentCheckoutUrlApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(ValueError):
                method(api, "tenant1", make_account(), provider="openai")

    def test_permission_denied(self, app: Flask):
        api = ModelProviderPaymentCheckoutUrlApi()
        method = unwrap(api.get)

        user = make_account()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.BillingService.is_tenant_owner_or_admin",
                side_effect=Forbidden(),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant1", user, provider="anthropic")
