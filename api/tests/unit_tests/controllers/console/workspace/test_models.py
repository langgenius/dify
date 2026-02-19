from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.workspace.models import (
    DefaultModelApi,
    ModelProviderAvailableModelApi,
    ModelProviderModelApi,
    ModelProviderModelCredentialApi,
    ModelProviderModelCredentialSwitchApi,
    ModelProviderModelDisableApi,
    ModelProviderModelEnableApi,
    ModelProviderModelParameterRuleApi,
    ModelProviderModelValidateApi,
)
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestDefaultModelApi:
    def test_get_success(self, app: Flask):
        api = DefaultModelApi()
        method = unwrap(api.get)

        with (
            app.test_request_context(
                "/",
                query_string={"model_type": ModelType.LLM.value},
            ),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService") as service_mock,
        ):
            service_mock.return_value.get_default_model_of_model_type.return_value = {"model": "gpt-4"}

            result = method(api)

        assert "data" in result

    def test_post_success(self, app: Flask):
        api = DefaultModelApi()
        method = unwrap(api.post)

        payload = {
            "model_settings": [
                {
                    "model_type": ModelType.LLM.value,
                    "provider": "openai",
                    "model": "gpt-4",
                }
            ]
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result = method(api)

        assert result["result"] == "success"

    def test_get_returns_empty_when_no_default(self, app):
        api = DefaultModelApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/", query_string={"model_type": ModelType.LLM.value}),
            patch("controllers.console.workspace.models.current_account_with_tenant", return_value=(MagicMock(), "t1")),
            patch("controllers.console.workspace.models.ModelProviderService") as service,
        ):
            service.return_value.get_default_model_of_model_type.return_value = None

            result = method(api)

        assert "data" in result


class TestModelProviderModelApi:
    def test_get_models_success(self, app: Flask):
        api = ModelProviderModelApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService") as service_mock,
        ):
            service_mock.return_value.get_models_by_provider.return_value = []

            result = method(api, "openai")

        assert "data" in result

    def test_post_models_success(self, app: Flask):
        api = ModelProviderModelApi()
        method = unwrap(api.post)

        payload = {
            "model": "gpt-4",
            "model_type": ModelType.LLM.value,
            "load_balancing": {
                "configs": [{"weight": 1}],
                "enabled": True,
            },
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
            patch("controllers.console.workspace.models.ModelLoadBalancingService"),
        ):
            result, status = method(api, "openai")

        assert status == 200

    def test_delete_model_success(self, app: Flask):
        api = ModelProviderModelApi()
        method = unwrap(api.delete)

        payload = {
            "model": "gpt-4",
            "model_type": ModelType.LLM.value,
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result, status = method(api, "openai")

        assert status == 204

    def test_get_models_returns_empty(self, app):
        api = ModelProviderModelApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.models.current_account_with_tenant", return_value=(MagicMock(), "t1")),
            patch("controllers.console.workspace.models.ModelProviderService") as service,
        ):
            service.return_value.get_models_by_provider.return_value = []

            result = method(api, "openai")

        assert "data" in result


class TestModelProviderModelCredentialApi:
    def test_get_credentials_success(self, app: Flask):
        api = ModelProviderModelCredentialApi()
        method = unwrap(api.get)

        with (
            app.test_request_context(
                "/",
                query_string={
                    "model": "gpt-4",
                    "model_type": ModelType.LLM.value,
                },
            ),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService") as provider_service,
            patch("controllers.console.workspace.models.ModelLoadBalancingService") as lb_service,
        ):
            provider_service.return_value.get_model_credential.return_value = {
                "credentials": {},
                "current_credential_id": None,
                "current_credential_name": None,
            }
            provider_service.return_value.provider_manager.get_provider_model_available_credentials.return_value = []
            lb_service.return_value.get_load_balancing_configs.return_value = (False, [])

            result = method(api, "openai")

        assert "credentials" in result

    def test_create_credential_success(self, app: Flask):
        api = ModelProviderModelCredentialApi()
        method = unwrap(api.post)

        payload = {
            "model": "gpt-4",
            "model_type": ModelType.LLM.value,
            "credentials": {"key": "val"},
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result, status = method(api, "openai")

        assert status == 201

    def test_get_empty_credentials(self, app):
        api = ModelProviderModelCredentialApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/", query_string={"model": "gpt", "model_type": ModelType.LLM.value}),
            patch("controllers.console.workspace.models.current_account_with_tenant", return_value=(MagicMock(), "t1")),
            patch("controllers.console.workspace.models.ModelProviderService") as service,
            patch("controllers.console.workspace.models.ModelLoadBalancingService") as lb,
        ):
            service.return_value.get_model_credential.return_value = None
            service.return_value.provider_manager.get_provider_model_available_credentials.return_value = []
            lb.return_value.get_load_balancing_configs.return_value = (False, [])

            result = method(api, "openai")

        assert result["credentials"] == {}

    def test_delete_success(self, app):
        api = ModelProviderModelCredentialApi()
        method = unwrap(api.delete)

        payload = {
            "model": "gpt",
            "model_type": ModelType.LLM.value,
            "credential_id": "123e4567-e89b-12d3-a456-426614174000",
        }

        with (
            app.test_request_context("/", json=payload),
            patch("controllers.console.workspace.models.current_account_with_tenant", return_value=(MagicMock(), "t1")),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result, status = method(api, "openai")

        assert status == 204


class TestModelProviderModelCredentialSwitchApi:
    def test_switch_success(self, app: Flask):
        api = ModelProviderModelCredentialSwitchApi()
        method = unwrap(api.post)

        payload = {
            "model": "gpt-4",
            "model_type": ModelType.LLM.value,
            "credential_id": "abc",
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result = method(api, "openai")

        assert result["result"] == "success"


class TestModelEnableDisableApis:
    def test_enable_model(self, app: Flask):
        api = ModelProviderModelEnableApi()
        method = unwrap(api.patch)

        payload = {
            "model": "gpt-4",
            "model_type": ModelType.LLM.value,
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result = method(api, "openai")

        assert result["result"] == "success"

    def test_disable_model(self, app: Flask):
        api = ModelProviderModelDisableApi()
        method = unwrap(api.patch)

        payload = {
            "model": "gpt-4",
            "model_type": ModelType.LLM.value,
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result = method(api, "openai")

        assert result["result"] == "success"


class TestModelProviderModelValidateApi:
    def test_validate_success(self, app: Flask):
        api = ModelProviderModelValidateApi()
        method = unwrap(api.post)

        payload = {
            "model": "gpt-4",
            "model_type": ModelType.LLM.value,
            "credentials": {"key": "val"},
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService"),
        ):
            result = method(api, "openai")

        assert result["result"] == "success"

    @pytest.mark.parametrize("model_name", ["gpt-4", "gpt"])
    def test_validate_failure(self, app: Flask, model_name: str):
        api = ModelProviderModelValidateApi()
        method = unwrap(api.post)

        payload = {
            "model": model_name,
            "model_type": ModelType.LLM.value,
            "credentials": {},
        }

        with (
            app.test_request_context("/", json=payload),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService") as service_mock,
        ):
            service_mock.return_value.validate_model_credentials.side_effect = CredentialsValidateFailedError("invalid")

            result = method(api, "openai")

        assert result["result"] == "error"


class TestParameterAndAvailableModels:
    def test_parameter_rules(self, app: Flask):
        api = ModelProviderModelParameterRuleApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/", query_string={"model": "gpt-4"}),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService") as service_mock,
        ):
            service_mock.return_value.get_model_parameter_rules.return_value = []

            result = method(api, "openai")

        assert "data" in result

    def test_available_models(self, app: Flask):
        api = ModelProviderAvailableModelApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.workspace.models.current_account_with_tenant",
                return_value=(MagicMock(), "tenant1"),
            ),
            patch("controllers.console.workspace.models.ModelProviderService") as service_mock,
        ):
            service_mock.return_value.get_models_by_model_type.return_value = []

            result = method(api, ModelType.LLM.value)

        assert "data" in result

    def test_empty_rules(self, app):
        api = ModelProviderModelParameterRuleApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/", query_string={"model": "gpt"}),
            patch("controllers.console.workspace.models.current_account_with_tenant", return_value=(MagicMock(), "t1")),
            patch("controllers.console.workspace.models.ModelProviderService") as service,
        ):
            service.return_value.get_model_parameter_rules.return_value = []

            result = method(api, "openai")

        assert result["data"] == []

    def test_no_models(self, app):
        api = ModelProviderAvailableModelApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.models.current_account_with_tenant", return_value=(MagicMock(), "t1")),
            patch("controllers.console.workspace.models.ModelProviderService") as service,
        ):
            service.return_value.get_models_by_model_type.return_value = []

            result = method(api, ModelType.LLM.value)

        assert result["data"] == []
