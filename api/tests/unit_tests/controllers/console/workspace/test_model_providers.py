from unittest.mock import MagicMock, patch

import pytest
from pydantic_core import ValidationError
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.model_providers import (
    ModelProviderCredentialApi,
    ModelProviderCredentialSwitchApi,
    ModelProviderIconApi,
    ModelProviderListApi,
    ModelProviderPaymentCheckoutUrlApi,
    ModelProviderValidateApi,
    PreferredProviderTypeUpdateApi,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError

VALID_UUID = "123e4567-e89b-12d3-a456-426614174000"
INVALID_UUID = "123"


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestModelProviderListApi:
    def test_get_success(self, app):
        api = ModelProviderListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/?model_type=llm"),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_provider_list",
                return_value=[{"name": "openai"}],
            ),
        ):
            result = method(api)

        assert "data" in result


class TestModelProviderCredentialApi:
    def test_get_success(self, app):
        api = ModelProviderCredentialApi()
        method = unwrap(api.get)

        with (
            app.test_request_context(f"/?credential_id={VALID_UUID}"),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_provider_credential",
                return_value={"key": "value"},
            ),
        ):
            result = method(api, provider="openai")

        assert "credentials" in result

    def test_get_invalid_uuid(self, app):
        api = ModelProviderCredentialApi()
        method = unwrap(api.get)

        with (
            app.test_request_context(f"/?credential_id={INVALID_UUID}"),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
        ):
            with pytest.raises(ValidationError):
                method(api, provider="openai")

    def test_post_create_success(self, app):
        api = ModelProviderCredentialApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}, "name": "test"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.create_provider_credential",
                return_value=None,
            ),
        ):
            result, status = method(api, provider="openai")

        assert result["result"] == "success"
        assert status == 201

    def test_post_create_validation_error(self, app):
        api = ModelProviderCredentialApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.create_provider_credential",
                side_effect=CredentialsValidateFailedError("bad"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, provider="openai")

    def test_put_update_success(self, app):
        api = ModelProviderCredentialApi()
        method = unwrap(api.put)

        payload = {"credential_id": VALID_UUID, "credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.update_provider_credential",
                return_value=None,
            ),
        ):
            result = method(api, provider="openai")

        assert result["result"] == "success"

    def test_put_invalid_uuid(self, app):
        api = ModelProviderCredentialApi()
        method = unwrap(api.put)

        payload = {"credential_id": INVALID_UUID, "credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
        ):
            with pytest.raises(ValidationError):
                method(api, provider="openai")

    def test_delete_success(self, app):
        api = ModelProviderCredentialApi()
        method = unwrap(api.delete)

        payload = {"credential_id": VALID_UUID}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.remove_provider_credential",
                return_value=None,
            ),
        ):
            result, status = method(api, provider="openai")

        assert result["result"] == "success"
        assert status == 204


class TestModelProviderCredentialSwitchApi:
    def test_switch_success(self, app):
        api = ModelProviderCredentialSwitchApi()
        method = unwrap(api.post)

        payload = {"credential_id": VALID_UUID}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.switch_active_provider_credential",
                return_value=None,
            ),
        ):
            result = method(api, provider="openai")

        assert result["result"] == "success"

    def test_switch_invalid_uuid(self, app):
        api = ModelProviderCredentialSwitchApi()
        method = unwrap(api.post)

        payload = {"credential_id": INVALID_UUID}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
        ):
            with pytest.raises(ValidationError):
                method(api, provider="openai")


class TestModelProviderValidateApi:
    def test_validate_success(self, app):
        api = ModelProviderValidateApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.validate_provider_credentials",
                return_value=None,
            ),
        ):
            result = method(api, provider="openai")

        assert result["result"] == "success"

    def test_validate_failure(self, app):
        api = ModelProviderValidateApi()
        method = unwrap(api.post)

        payload = {"credentials": {"a": "b"}}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.validate_provider_credentials",
                side_effect=CredentialsValidateFailedError("bad"),
            ),
        ):
            result = method(api, provider="openai")

        assert result["result"] == "error"


class TestModelProviderIconApi:
    def test_icon_success(self, app):
        api = ModelProviderIconApi()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.get_model_provider_icon",
                return_value=(b"123", "image/png"),
            ),
        ):
            response = api.get("t1", "openai", "logo", "en")

        assert response.mimetype == "image/png"

    def test_icon_not_found(self, app):
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
    def test_update_success(self, app):
        api = PreferredProviderTypeUpdateApi()
        method = unwrap(api.post)

        payload = {"preferred_provider_type": "custom"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.ModelProviderService.switch_preferred_provider",
                return_value=None,
            ),
        ):
            result = method(api, provider="openai")

        assert result["result"] == "success"

    def test_invalid_enum(self, app):
        api = PreferredProviderTypeUpdateApi()
        method = unwrap(api.post)

        payload = {"preferred_provider_type": "invalid"}

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
        ):
            with pytest.raises(ValidationError):
                method(api, provider="openai")


class TestModelProviderPaymentCheckoutUrlApi:
    def test_checkout_success(self, app):
        api = ModelProviderPaymentCheckoutUrlApi()
        method = unwrap(api.get)

        user = MagicMock(id="u1", email="x@test.com")

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(user, "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.BillingService.is_tenant_owner_or_admin",
                return_value=None,
            ),
            patch(
                "controllers.console.workspace.model_providers.BillingService.get_model_provider_payment_link",
                return_value={"url": "x"},
            ),
        ):
            result = method(api, provider="anthropic")

        assert "url" in result

    def test_invalid_provider(self, app):
        api = ModelProviderPaymentCheckoutUrlApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(ValueError):
                method(api, provider="openai")

    def test_permission_denied(self, app):
        api = ModelProviderPaymentCheckoutUrlApi()
        method = unwrap(api.get)

        user = MagicMock(id="u1", email="x@test.com")

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.model_providers.current_account_with_tenant",
                return_value=(user, "tenant1"),
            ),
            patch(
                "controllers.console.workspace.model_providers.BillingService.is_tenant_owner_or_admin",
                side_effect=Forbidden(),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, provider="anthropic")
