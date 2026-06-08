from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.entities.model_entities import ModelStatus
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelType, ParameterRule, ParameterType
from models.provider import ProviderType
from services import model_provider_service as service_module
from services.errors.app_model_config import ProviderNotFoundError
from services.model_provider_service import ModelProviderService


def _create_service_with_mocked_manager() -> tuple[ModelProviderService, MagicMock]:
    manager = MagicMock()
    service = ModelProviderService()
    service._get_provider_manager = MagicMock(return_value=manager)
    return service, manager


def _build_provider_configuration(
    *,
    provider_name: str = "openai",
    supported_model_types: list[ModelType] | None = None,
    custom_models: list[Any] | None = None,
    custom_config_available: bool = True,
) -> SimpleNamespace:
    if supported_model_types is None:
        supported_model_types = [ModelType.LLM]

    return SimpleNamespace(
        provider=SimpleNamespace(
            provider=provider_name,
            label=I18nObject(en_US=provider_name),
            description=None,
            icon_small=None,
            icon_small_dark=None,
            background=None,
            help=None,
            supported_model_types=supported_model_types,
            configurate_methods=[],
            provider_credential_schema=None,
            model_credential_schema=None,
        ),
        preferred_provider_type=ProviderType.CUSTOM,
        custom_configuration=SimpleNamespace(
            provider=SimpleNamespace(
                current_credential_id="cred-1",
                current_credential_name="Credential 1",
                available_credentials=[],
            ),
            models=custom_models,
            can_added_models=[],
        ),
        system_configuration=SimpleNamespace(enabled=False, current_quota_type=None, quota_configurations=[]),
        is_custom_configuration_available=lambda: custom_config_available,
    )


class TestModelProviderServiceConfiguration:
    def test__get_provider_configuration_should_return_configuration_when_provider_exists(self) -> None:
        service, manager = _create_service_with_mocked_manager()
        provider_configuration = SimpleNamespace(name="provider-config")
        manager.get_configurations.return_value = {"openai": provider_configuration}

        result = service._get_provider_configuration(tenant_id="tenant-1", provider="openai")

        assert result is provider_configuration

    def test__get_provider_configuration_should_raise_error_when_provider_is_missing(self) -> None:
        service, manager = _create_service_with_mocked_manager()
        manager.get_configurations.return_value = {}

        with pytest.raises(ProviderNotFoundError, match="does not exist"):
            service._get_provider_configuration(tenant_id="tenant-1", provider="missing")

    def test_get_provider_list_should_filter_by_model_type_and_build_no_configure_status(self) -> None:
        service, manager = _create_service_with_mocked_manager()
        allowed = _build_provider_configuration(
            provider_name="openai",
            supported_model_types=[ModelType.LLM],
            custom_config_available=False,
        )
        filtered = _build_provider_configuration(
            provider_name="embedding",
            supported_model_types=[ModelType.TEXT_EMBEDDING],
            custom_config_available=True,
        )
        manager.get_configurations.return_value = {"openai": allowed, "embedding": filtered}

        result = service.get_provider_list(tenant_id="tenant-1", model_type=ModelType.LLM)

        assert len(result) == 1
        assert result[0].provider == "openai"
        assert result[0].custom_configuration.status.value == "no-configure"

    def test_get_models_by_provider_should_wrap_model_entities_with_tenant_context(self) -> None:
        service, manager = _create_service_with_mocked_manager()

        class _Model:
            def __init__(self, model_name: str) -> None:
                self.model_name = model_name

            def model_dump(self) -> dict[str, Any]:
                return {
                    "model": self.model_name,
                    "label": {"en_US": self.model_name},
                    "model_type": ModelType.LLM,
                    "features": [],
                    "fetch_from": FetchFrom.PREDEFINED_MODEL,
                    "model_properties": {},
                    "deprecated": False,
                    "status": ModelStatus.ACTIVE,
                    "load_balancing_enabled": False,
                    "has_invalid_load_balancing_configs": False,
                    "provider": {
                        "provider": "openai",
                        "label": {"en_US": "OpenAI"},
                        "icon_small": None,
                        "icon_small_dark": None,
                        "supported_model_types": [ModelType.LLM],
                    },
                }

        provider_configurations = SimpleNamespace(
            get_models=MagicMock(return_value=[_Model("gpt-4o"), _Model("gpt-4o-mini")])
        )
        manager.get_configurations.return_value = provider_configurations

        result = service.get_models_by_provider(tenant_id="tenant-1", provider="openai")

        assert len(result) == 2
        assert result[0].model == "gpt-4o"
        assert result[1].provider.provider == "openai"
        provider_configurations.get_models.assert_called_once_with(provider="openai")


class TestModelProviderServiceDelegation:
    @pytest.mark.parametrize(
        ("method_name", "method_kwargs", "provider_method_name", "provider_call_kwargs", "provider_return"),
        [
            (
                "get_provider_credential",
                {"tenant_id": "tenant-1", "provider": "openai", "credential_id": "cred-1"},
                "get_provider_credential",
                {"credential_id": "cred-1"},
                {"token": "abc"},
            ),
            (
                "validate_provider_credentials",
                {"tenant_id": "tenant-1", "provider": "openai", "credentials": {"token": "abc"}},
                "validate_provider_credentials",
                ({"token": "abc"},),
                None,
            ),
            (
                "create_provider_credential",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "credentials": {"token": "abc"},
                    "credential_name": "A",
                },
                "create_provider_credential",
                ({"token": "abc"}, "A"),
                None,
            ),
            (
                "update_provider_credential",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "credentials": {"token": "abc"},
                    "credential_id": "cred-1",
                    "credential_name": "B",
                },
                "update_provider_credential",
                {"credential_id": "cred-1", "credentials": {"token": "abc"}, "credential_name": "B"},
                None,
            ),
            (
                "remove_provider_credential",
                {"tenant_id": "tenant-1", "provider": "openai", "credential_id": "cred-1"},
                "delete_provider_credential",
                {"credential_id": "cred-1"},
                None,
            ),
            (
                "switch_active_provider_credential",
                {"tenant_id": "tenant-1", "provider": "openai", "credential_id": "cred-1"},
                "switch_active_provider_credential",
                {"credential_id": "cred-1"},
                None,
            ),
        ],
    )
    def test_provider_credential_methods_should_delegate_to_provider_configuration(
        self,
        method_name: str,
        method_kwargs: dict[str, Any],
        provider_method_name: str,
        provider_call_kwargs: Any,
        provider_return: Any,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service = ModelProviderService()
        provider_configuration = MagicMock()
        getattr(provider_configuration, provider_method_name).return_value = provider_return
        get_provider_config_mock = MagicMock(return_value=provider_configuration)
        monkeypatch.setattr(service, "_get_provider_configuration", get_provider_config_mock)

        result = getattr(service, method_name)(**method_kwargs)

        get_provider_config_mock.assert_called_once_with("tenant-1", "openai")
        provider_method = getattr(provider_configuration, provider_method_name)
        if isinstance(provider_call_kwargs, tuple):
            provider_method.assert_called_once_with(*provider_call_kwargs)
        elif isinstance(provider_call_kwargs, dict):
            provider_method.assert_called_once_with(**provider_call_kwargs)
        else:
            provider_method.assert_called_once_with(provider_call_kwargs)
        if method_name == "get_provider_credential":
            assert result == {"token": "abc"}

    @pytest.mark.parametrize(
        ("method_name", "method_kwargs", "provider_method_name", "expected_kwargs", "provider_return"),
        [
            (
                "get_model_credential",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credential_id": "cred-1",
                },
                "get_custom_model_credential",
                {"model_type": ModelType.LLM, "model": "gpt-4o", "credential_id": "cred-1"},
                {"api_key": "x"},
            ),
            (
                "validate_model_credentials",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credentials": {"api_key": "x"},
                },
                "validate_custom_model_credentials",
                {"model_type": ModelType.LLM, "model": "gpt-4o", "credentials": {"api_key": "x"}},
                None,
            ),
            (
                "create_model_credential",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credentials": {"api_key": "x"},
                    "credential_name": "cred-a",
                },
                "create_custom_model_credential",
                {
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credentials": {"api_key": "x"},
                    "credential_name": "cred-a",
                },
                None,
            ),
            (
                "update_model_credential",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credentials": {"api_key": "x"},
                    "credential_id": "cred-1",
                    "credential_name": "cred-b",
                },
                "update_custom_model_credential",
                {
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credentials": {"api_key": "x"},
                    "credential_id": "cred-1",
                    "credential_name": "cred-b",
                },
                None,
            ),
            (
                "remove_model_credential",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credential_id": "cred-1",
                },
                "delete_custom_model_credential",
                {"model_type": ModelType.LLM, "model": "gpt-4o", "credential_id": "cred-1"},
                None,
            ),
            (
                "switch_active_custom_model_credential",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credential_id": "cred-1",
                },
                "switch_custom_model_credential",
                {"model_type": ModelType.LLM, "model": "gpt-4o", "credential_id": "cred-1"},
                None,
            ),
            (
                "add_model_credential_to_model_list",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                    "credential_id": "cred-1",
                },
                "add_model_credential_to_model",
                {"model_type": ModelType.LLM, "model": "gpt-4o", "credential_id": "cred-1"},
                None,
            ),
            (
                "remove_model",
                {
                    "tenant_id": "tenant-1",
                    "provider": "openai",
                    "model_type": ModelType.LLM,
                    "model": "gpt-4o",
                },
                "delete_custom_model",
                {"model_type": ModelType.LLM, "model": "gpt-4o"},
                None,
            ),
        ],
    )
    def test_custom_model_methods_should_convert_model_type_and_delegate(
        self,
        method_name: str,
        method_kwargs: dict[str, Any],
        provider_method_name: str,
        expected_kwargs: dict[str, Any],
        provider_return: Any,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service = ModelProviderService()
        provider_configuration = MagicMock()
        getattr(provider_configuration, provider_method_name).return_value = provider_return
        get_provider_config_mock = MagicMock(return_value=provider_configuration)
        monkeypatch.setattr(service, "_get_provider_configuration", get_provider_config_mock)

        result = getattr(service, method_name)(**method_kwargs)

        get_provider_config_mock.assert_called_once_with("tenant-1", "openai")
        getattr(provider_configuration, provider_method_name).assert_called_once_with(**expected_kwargs)
        if method_name == "get_model_credential":
            assert result == {"api_key": "x"}


class TestModelProviderServiceListingsAndDefaults:
    def test_get_models_by_model_type_should_group_active_non_deprecated_models(self) -> None:
        service, manager = _create_service_with_mocked_manager()
        openai_provider = SimpleNamespace(
            provider="openai",
            label=I18nObject(en_US="OpenAI"),
            icon_small=None,
            icon_small_dark=None,
        )
        anthropic_provider = SimpleNamespace(
            provider="anthropic",
            label=I18nObject(en_US="Anthropic"),
            icon_small=None,
            icon_small_dark=None,
        )
        models = [
            SimpleNamespace(
                provider=openai_provider,
                model="gpt-4o",
                label=I18nObject(en_US="GPT-4o"),
                model_type=ModelType.LLM,
                features=[],
                fetch_from=FetchFrom.PREDEFINED_MODEL,
                model_properties={},
                status=ModelStatus.ACTIVE,
                load_balancing_enabled=False,
                deprecated=False,
            ),
            SimpleNamespace(
                provider=openai_provider,
                model="old-openai",
                label=I18nObject(en_US="Old OpenAI"),
                model_type=ModelType.LLM,
                features=[],
                fetch_from=FetchFrom.PREDEFINED_MODEL,
                model_properties={},
                status=ModelStatus.ACTIVE,
                load_balancing_enabled=False,
                deprecated=True,
            ),
            SimpleNamespace(
                provider=anthropic_provider,
                model="old-anthropic",
                label=I18nObject(en_US="Old Anthropic"),
                model_type=ModelType.LLM,
                features=[],
                fetch_from=FetchFrom.PREDEFINED_MODEL,
                model_properties={},
                status=ModelStatus.ACTIVE,
                load_balancing_enabled=False,
                deprecated=True,
            ),
        ]
        provider_configurations = SimpleNamespace(get_models=MagicMock(return_value=models))
        manager.get_configurations.return_value = provider_configurations

        result = service.get_models_by_model_type(tenant_id="tenant-1", model_type=ModelType.LLM)

        provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)
        assert len(result) == 1
        assert result[0].provider == "openai"
        assert len(result[0].models) == 1
        assert result[0].models[0].model == "gpt-4o"

    @pytest.mark.parametrize(
        ("credentials", "schema", "expected_count"),
        [
            (None, None, 0),
            ({"api_key": "x"}, None, 0),
            (
                {"api_key": "x"},
                SimpleNamespace(
                    parameter_rules=[
                        ParameterRule(
                            name="temperature",
                            label=I18nObject(en_US="Temperature"),
                            type=ParameterType.FLOAT,
                        )
                    ]
                ),
                1,
            ),
        ],
    )
    def test_get_model_parameter_rules_should_handle_missing_credentials_and_schema(
        self,
        credentials: dict[str, Any] | None,
        schema: Any,
        expected_count: int,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service = ModelProviderService()
        provider_configuration = MagicMock()
        provider_configuration.get_current_credentials.return_value = credentials
        provider_configuration.get_model_schema.return_value = schema
        monkeypatch.setattr(service, "_get_provider_configuration", MagicMock(return_value=provider_configuration))

        result = service.get_model_parameter_rules(tenant_id="tenant-1", provider="openai", model="gpt-4o")

        assert len(result) == expected_count
        provider_configuration.get_current_credentials.assert_called_once_with(
            model_type=ModelType.LLM,
            model="gpt-4o",
        )
        if credentials:
            provider_configuration.get_model_schema.assert_called_once_with(
                model_type=ModelType.LLM,
                model="gpt-4o",
                credentials=credentials,
            )
        else:
            provider_configuration.get_model_schema.assert_not_called()

    def test_get_default_model_of_model_type_should_return_response_when_manager_returns_model(self) -> None:
        service, manager = _create_service_with_mocked_manager()
        manager.get_default_model.return_value = SimpleNamespace(
            model="gpt-4o",
            model_type=ModelType.LLM,
            provider=SimpleNamespace(
                provider="openai",
                label=I18nObject(en_US="OpenAI"),
                icon_small=None,
                supported_model_types=[ModelType.LLM],
            ),
        )

        result = service.get_default_model_of_model_type(tenant_id="tenant-1", model_type=ModelType.LLM)

        assert result is not None
        assert result.model == "gpt-4o"
        assert result.provider.provider == "openai"
        manager.get_default_model.assert_called_once_with(tenant_id="tenant-1", model_type=ModelType.LLM)

    def test_get_default_model_of_model_type_should_return_none_when_manager_returns_none(self) -> None:
        service, manager = _create_service_with_mocked_manager()
        manager.get_default_model.return_value = None

        result = service.get_default_model_of_model_type(tenant_id="tenant-1", model_type=ModelType.LLM)

        assert result is None

    def test_get_default_model_of_model_type_should_return_none_when_manager_raises_exception(self) -> None:
        service, manager = _create_service_with_mocked_manager()
        manager.get_default_model.side_effect = RuntimeError("boom")

        result = service.get_default_model_of_model_type(tenant_id="tenant-1", model_type=ModelType.LLM)

        assert result is None

    def test_update_default_model_of_model_type_should_delegate_to_provider_manager(self) -> None:
        service, manager = _create_service_with_mocked_manager()

        service.update_default_model_of_model_type(
            tenant_id="tenant-1",
            model_type=ModelType.LLM,
            provider="openai",
            model="gpt-4o",
        )

        manager.update_default_model_record.assert_called_once_with(
            tenant_id="tenant-1",
            model_type=ModelType.LLM,
            provider="openai",
            model="gpt-4o",
        )

    def test_get_model_provider_icon_should_fetch_icon_bytes_from_factory(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service = ModelProviderService()
        factory_instance = MagicMock()
        factory_instance.get_provider_icon.return_value = (b"icon-bytes", "image/png")
        factory_constructor = MagicMock(return_value=factory_instance)
        monkeypatch.setattr(service_module, "create_plugin_model_provider_factory", factory_constructor)

        result = service.get_model_provider_icon(
            tenant_id="tenant-1",
            provider="openai",
            icon_type="icon_small",
            lang="en_US",
        )

        factory_constructor.assert_called_once_with(tenant_id="tenant-1")
        factory_instance.get_provider_icon.assert_called_once_with("openai", "icon_small", "en_US")
        assert result == (b"icon-bytes", "image/png")

    def test_switch_preferred_provider_should_convert_enum_and_delegate(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service = ModelProviderService()
        provider_configuration = MagicMock()
        monkeypatch.setattr(service, "_get_provider_configuration", MagicMock(return_value=provider_configuration))

        service.switch_preferred_provider(
            tenant_id="tenant-1",
            provider="openai",
            preferred_provider_type=ProviderType.SYSTEM.value,
        )

        provider_configuration.switch_preferred_provider_type.assert_called_once_with(ProviderType.SYSTEM)

    @pytest.mark.parametrize(
        ("method_name", "provider_method_name"),
        [
            ("enable_model", "enable_model"),
            ("disable_model", "disable_model"),
        ],
    )
    def test_model_enablement_methods_should_convert_model_type_and_delegate(
        self,
        method_name: str,
        provider_method_name: str,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service = ModelProviderService()
        provider_configuration = MagicMock()
        monkeypatch.setattr(service, "_get_provider_configuration", MagicMock(return_value=provider_configuration))

        getattr(service, method_name)(
            tenant_id="tenant-1",
            provider="openai",
            model="gpt-4o",
            model_type=ModelType.LLM,
        )

        getattr(provider_configuration, provider_method_name).assert_called_once_with(
            model="gpt-4o",
            model_type=ModelType.LLM,
        )
