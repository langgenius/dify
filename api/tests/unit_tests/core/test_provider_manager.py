from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from flask import has_app_context
from sqlalchemy import Engine, delete, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core import provider_manager as provider_manager_module
from core.entities.model_entities import DefaultModelSetting
from core.entities.provider_configuration import (
    ProviderConfiguration,
    ProviderConfigurations,
    ProviderModelBundle,
)
from core.entities.provider_entities import (
    CustomConfiguration,
    CustomProviderConfiguration,
    ModelSettings,
    ProviderQuotaType,
    SystemConfiguration,
)
from core.helper.model_provider_cache import ProviderCredentialsCacheType
from core.hosting_configuration import HostingProvider, TrialHostingQuota
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.provider_manager import (
    ProviderConfigurationCacheSource,
    ProviderManager,
    _LoadBalancingModelConfigCacheEntry,
    _ProviderModelSettingCacheEntry,
)
from enums import CloudPlan, DeploymentEdition
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    FieldModelSchema,
    ModelCredentialSchema,
    ProviderCredentialSchema,
    ProviderEntity,
)
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.enums import ProviderQuotaType as ModelProviderQuotaType
from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    ProviderModelSetting,
    ProviderType,
    TenantDefaultModel,
    TenantPreferredModelProvider,
)
from models.provider_ids import ModelProviderID
from services.credit_pool_service import CreditPoolBalance
from services.entities.feature_entities import FeatureModel
from tests.helpers.unit.config_override import config_overrides_context


def _build_provider_manager() -> ProviderManager:
    return ProviderManager(model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"))


def _persist_model_configuration(
    session: Session,
    setting: ProviderModelSetting,
    load_balancing_configs: list[LoadBalancingModelConfig],
) -> tuple[list[_ProviderModelSettingCacheEntry], list[_LoadBalancingModelConfigCacheEntry]]:
    session.add_all([setting, *load_balancing_configs])
    session.commit()
    session.expire_all()
    settings = list(
        session.scalars(select(ProviderModelSetting).where(ProviderModelSetting.tenant_id == setting.tenant_id)).all()
    )
    configs = list(
        session.scalars(
            select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.tenant_id == setting.tenant_id)
        ).all()
    )
    return (
        [_ProviderModelSettingCacheEntry.from_record(record) for record in settings],
        [_LoadBalancingModelConfigCacheEntry.from_record(record) for record in configs],
    )


def _build_plugin_provider_declaration(
    installation_source: PluginInstallationSource | None,
) -> PluginModelProviderDeclaration:
    return PluginModelProviderDeclaration(
        provider="langgenius/openai/openai",
        plugin_unique_identifier="langgenius/openai:1.0.0@checksum",
        installation_source=installation_source,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


def _build_hosting_provider() -> HostingProvider:
    return HostingProvider(
        enabled=True,
        credentials={"api_key": "system-secret"},
        quotas=[TrialHostingQuota(quota_limit=100)],
    )


def _build_trial_provider_record() -> Provider:
    return Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.SYSTEM,
        quota_type=ModelProviderQuotaType.TRIAL,
        quota_limit=100,
        quota_used=0,
        is_valid=True,
    )


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.expirations: dict[str, int] = {}

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self.store[key] = value
        if ex is not None:
            self.expirations[key] = ex

    def setex(self, key: str, time: int, value: str) -> None:
        self.store[key] = value
        self.expirations[key] = time

    def incr(self, key: str) -> int:
        value = int(self.store.get(key, "0")) + 1
        self.store[key] = str(value)
        return value

    def expire(self, key: str, time: int) -> None:
        self.expirations[key] = time


@pytest.fixture
def mock_provider_entity() -> ProviderEntity:
    return ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        provider_credential_schema=ProviderCredentialSchema(credential_form_schemas=[]),
        model_credential_schema=ModelCredentialSchema(
            model=FieldModelSchema(label=I18nObject(en_US="OpenAI")),
            credential_form_schemas=[],
        ),
    )


def test__to_model_settings(mock_provider_entity: ProviderEntity, sqlite_session: Session) -> None:
    # Mocking the inputs
    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        enabled=True,
        load_balancing_enabled=True,
    )
    ps.id = "id"

    provider_model_settings = [ps]

    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
            name="first",
            encrypted_config='{"openai_api_key": "fake_key"}',
            enabled=True,
        ),
    ]
    load_balancing_model_configs[0].id = "id1"
    load_balancing_model_configs[1].id = "id2"
    provider_model_settings, load_balancing_model_configs = _persist_model_configuration(
        sqlite_session, ps, load_balancing_model_configs
    )

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager()

        # Running the method
        result = provider_manager._to_model_settings(
            provider_entity=mock_provider_entity,
            provider_model_settings=provider_model_settings,
            load_balancing_model_configs=load_balancing_model_configs,
        )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 2
    assert result[0].load_balancing_configs[0].name == "__inherit__"
    assert result[0].load_balancing_configs[1].name == "first"


@pytest.mark.parametrize("encrypted_config", ["{", "[]"])
def test_invalid_credentials_are_not_decrypted_or_cached(encrypted_config: str) -> None:
    manager = _build_provider_manager()
    with (
        patch("core.provider_manager.ProviderCredentialsCache") as cache,
        patch.object(manager, "_get_decoding_context") as decoding_context,
    ):
        cache.return_value.get.return_value = None
        credentials = manager._get_and_decrypt_credentials(
            tenant_id="tenant-id",
            record_id="credential-id",
            encrypted_config=encrypted_config,
            secret_variables=["api_key"],
            cache_type=ProviderCredentialsCacheType.MODEL,
        )

    assert credentials == {}
    decoding_context.assert_not_called()
    cache.return_value.set.assert_not_called()


@pytest.mark.parametrize("encrypted_config", ["{", "[]"])
def test_invalid_load_balancing_credentials_preserve_valid_configs(
    mock_provider_entity: ProviderEntity, sqlite_session: Session, encrypted_config: str
) -> None:
    setting = ProviderModelSetting(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        enabled=True,
        load_balancing_enabled=True,
    )
    configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant-id",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
            name=name,
            encrypted_config=credentials,
            enabled=True,
        )
        for name, credentials in [("__inherit__", None), ("invalid", encrypted_config), ("valid", "{}")]
    ]
    settings, configs = _persist_model_configuration(sqlite_session, setting, configs)
    manager = _build_provider_manager()
    with (
        patch("core.provider_manager.ProviderCredentialsCache") as cache,
        patch.object(manager, "_get_decoding_context") as decoding_context,
    ):
        cache.return_value.get.side_effect = [None, {"api_key": "cached-secret"}]
        result = manager._to_model_settings(mock_provider_entity, settings, configs)

    assert len(result) == 1
    assert [config.name for config in result[0].load_balancing_configs] == ["__inherit__", "valid"]
    assert result[0].load_balancing_configs[1].credentials == {"api_key": "cached-secret"}
    decoding_context.assert_not_called()
    cache.return_value.set.assert_not_called()


@pytest.mark.parametrize(
    "installation_source",
    [
        None,
        PluginInstallationSource.Github,
        PluginInstallationSource.Package,
        PluginInstallationSource.Remote,
    ],
)
def test_to_system_configuration_rejects_non_marketplace_provider(
    installation_source: PluginInstallationSource | None,
) -> None:
    provider_entity = _build_plugin_provider_declaration(installation_source)
    manager = _build_provider_manager()

    with (
        patch.object(manager, "_choice_current_using_quota_type") as choose_quota,
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
    ):
        configuration = manager._to_system_configuration("tenant-id", provider_entity, [])

    assert configuration.enabled is False
    assert configuration.credentials is None
    choose_quota.assert_not_called()


def test_to_system_configuration_rejects_unverified_marketplace_provider() -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager()

    with (
        patch.object(manager, "_choice_current_using_quota_type") as choose_quota,
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
        patch(
            "core.plugin.plugin_service.PluginService.is_plugin_verified",
            return_value=False,
        ) as is_plugin_verified,
    ):
        configuration = manager._to_system_configuration("tenant-id", provider_entity, [])

    assert configuration.enabled is False
    assert configuration.credentials is None
    is_plugin_verified.assert_called_once_with("tenant-id", provider_entity.plugin_unique_identifier)
    choose_quota.assert_not_called()


def test_to_system_configuration_never_returns_hosting_credentials_for_package_with_valid_quota() -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Package)
    manager = _build_provider_manager()

    with patch(
        "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
        {provider_entity.provider: _build_hosting_provider()},
    ):
        configuration = manager._to_system_configuration(
            "tenant-id",
            provider_entity,
            [_build_trial_provider_record()],
        )

    assert configuration.enabled is False
    assert configuration.credentials is None


def test_to_system_configuration_uses_owned_session_for_cloud_credit_pools() -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager()
    trial_pool = CreditPoolBalance(
        tenant_id="tenant-id", pool_type=ProviderQuotaType.TRIAL.value, quota_limit=100, quota_used=0
    )
    paid_pool = CreditPoolBalance(
        tenant_id="tenant-id", pool_type=ProviderQuotaType.PAID.value, quota_limit=0, quota_used=0
    )

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
        patch(
            "core.plugin.plugin_service.PluginService.is_plugin_verified",
            return_value=True,
        ),
        patch("core.provider_manager.FeatureService.get_workspace_plan") as get_workspace_plan,
        patch(
            "services.credit_pool_service.CreditPoolService.get_pool",
            side_effect=[trial_pool, paid_pool],
        ) as get_pool,
    ):
        get_workspace_plan.side_effect = [CloudPlan.SANDBOX, CloudPlan.TEAM]
        with ThreadPoolExecutor(max_workers=1) as executor:
            assert executor.submit(has_app_context).result() is False
            configuration = executor.submit(
                manager._to_system_configuration,
                "tenant-id",
                provider_entity,
                [_build_trial_provider_record()],
            ).result()
            executor.submit(
                manager._to_system_configuration,
                "tenant-id",
                provider_entity,
                [_build_trial_provider_record()],
            ).result()

    assert configuration.enabled is True
    assert [call.kwargs["pool_type"] for call in get_pool.call_args_list] == [
        ProviderQuotaType.TRIAL,
        ProviderQuotaType.PAID,
    ]
    assert all(isinstance(call.kwargs["session"], Session) for call in get_pool.call_args_list)


def test_to_system_configuration_preserves_marketplace_behavior() -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager()

    with (
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
        patch(
            "core.plugin.plugin_service.PluginService.is_plugin_verified",
            return_value=True,
        ) as is_plugin_verified,
    ):
        configuration = manager._to_system_configuration(
            "tenant-id",
            provider_entity,
            [_build_trial_provider_record()],
        )

    assert configuration.enabled is True
    assert configuration.credentials == {"api_key": "system-secret"}
    assert configuration.current_quota_type == ProviderQuotaType.TRIAL
    is_plugin_verified.assert_called_once_with("tenant-id", provider_entity.plugin_unique_identifier)


def test_package_provider_keeps_custom_configuration() -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Package)
    manager = _build_provider_manager()
    custom_configuration = CustomConfiguration(
        provider=CustomProviderConfiguration(credentials={"api_key": "user-secret"})
    )

    with (
        patch.object(manager, "_get_all_providers", return_value={provider_entity.provider: []}),
        patch.object(
            manager,
            "_init_trial_provider_records",
            return_value={provider_entity.provider: []},
        ),
        patch.object(manager, "_get_all_provider_models", return_value={}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch.object(manager._model_runtime, "fetch_model_providers", return_value=[provider_entity]),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
    ):
        configuration = manager.get_configurations("tenant-id").get(provider_entity.provider)

    assert configuration is not None
    assert configuration.system_configuration.enabled is False
    assert configuration.custom_configuration.provider is not None
    assert configuration.custom_configuration.provider.credentials == {"api_key": "user-secret"}


def test__to_model_settings_only_one_lb(mock_provider_entity: ProviderEntity, sqlite_session: Session) -> None:
    # Mocking the inputs

    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        enabled=True,
        load_balancing_enabled=True,
    )
    ps.id = "id"
    provider_model_settings = [ps]
    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        )
    ]
    load_balancing_model_configs[0].id = "id1"
    provider_model_settings, load_balancing_model_configs = _persist_model_configuration(
        sqlite_session, ps, load_balancing_model_configs
    )

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager()

        # Running the method
        result = provider_manager._to_model_settings(
            provider_entity=mock_provider_entity,
            provider_model_settings=provider_model_settings,
            load_balancing_model_configs=load_balancing_model_configs,
        )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 0


def test__to_model_settings_lb_disabled(mock_provider_entity: ProviderEntity, sqlite_session: Session) -> None:
    # Mocking the inputs
    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        enabled=True,
        load_balancing_enabled=False,
    )
    ps.id = "id"
    provider_model_settings = [ps]
    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
            name="first",
            encrypted_config='{"openai_api_key": "fake_key"}',
            enabled=True,
        ),
    ]
    load_balancing_model_configs[0].id = "id1"
    load_balancing_model_configs[1].id = "id2"
    provider_model_settings, load_balancing_model_configs = _persist_model_configuration(
        sqlite_session, ps, load_balancing_model_configs
    )

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager()

        # Running the method
        result = provider_manager._to_model_settings(
            provider_entity=mock_provider_entity,
            provider_model_settings=provider_model_settings,
            load_balancing_model_configs=load_balancing_model_configs,
        )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 0


def test_get_default_model_uses_injected_runtime_for_existing_default_record(sqlite_session: Session) -> None:
    existing_default_model = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
    )
    sqlite_session.add(existing_default_model)
    sqlite_session.commit()
    manager = _build_provider_manager()
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
        icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )

    with patch.object(manager._model_runtime, "fetch_model_providers", return_value=[provider_schema]):
        result = manager.get_default_model("tenant-id", ModelType.LLM)

    assert isinstance(manager._model_runtime, PluginModelRuntime)
    assert result is not None
    assert result.model == "gpt-4"
    assert result.provider.provider == "openai"
    assert result.provider.label == I18nObject(en_US="OpenAI", zh_Hans="OpenAI")


def test_get_configurations_uses_injected_runtime_and_adds_provider_aliases(sqlite_session: Session) -> None:
    manager = _build_provider_manager()
    provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    provider_model = ProviderModel(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        is_valid=True,
    )
    preferred_provider = TenantPreferredModelProvider(
        tenant_id="tenant-id",
        provider_name="openai",
        preferred_provider_type=ProviderType.SYSTEM,
    )
    sqlite_session.add_all([provider, provider_model, preferred_provider])
    sqlite_session.commit()
    with patch("core.provider_manager.redis_client", _FakeRedis()):
        provider_model_records = ProviderManager._get_all_provider_models("tenant-id")
        preferred_provider_records = ProviderManager._get_all_preferred_model_providers("tenant-id")
    provider_records = {"openai": [provider]}

    with (
        patch.object(manager, "_get_all_providers", return_value=provider_records),
        patch.object(manager, "_init_trial_provider_records", return_value=provider_records),
        patch.object(manager, "_get_all_provider_models", return_value=provider_model_records),
        patch.object(manager, "_get_all_preferred_model_providers", return_value=preferred_provider_records),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager._model_runtime, "fetch_model_providers", return_value=[]),
    ):
        result = manager.get_configurations("tenant-id")

    expected_alias = str(ModelProviderID("openai"))
    assert result.tenant_id == "tenant-id"
    assert expected_alias in provider_records
    assert expected_alias in provider_model_records
    assert expected_alias in preferred_provider_records


@pytest.mark.parametrize(
    ("provider_name", "expected_provider_names"),
    [
        ("openai", ["openai", "langgenius/openai/openai"]),
        ("langgenius/openai/openai", ["langgenius/openai/openai", "openai"]),
        ("langgenius/gemini/google", ["langgenius/gemini/google", "google"]),
    ],
)
def test_get_provider_names_returns_short_and_full_aliases(
    provider_name: str, expected_provider_names: list[str]
) -> None:
    assert ProviderManager._get_provider_names(provider_name) == expected_provider_names


def test_get_provider_model_bundle_raises_for_unknown_provider() -> None:
    manager = _build_provider_manager()

    with patch.object(manager, "get_configurations", return_value={}):
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            manager.get_provider_model_bundle("tenant-id", "openai", ModelType.LLM)


def test_get_configurations_binds_manager_runtime_to_provider_configuration(
    mock_provider_entity: ProviderEntity,
) -> None:
    manager = _build_provider_manager()

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}),
        patch.object(manager, "_init_trial_provider_records", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager._model_runtime, "fetch_model_providers", return_value=[mock_provider_entity]),
    ):
        configurations = manager.get_configurations("tenant-id")

    configuration = configurations["openai"]
    assert isinstance(configuration, ProviderConfiguration)
    assert configuration._bound_model_runtime is manager._model_runtime


@pytest.mark.parametrize(
    ("quota_is_valid", "has_custom_provider", "has_custom_model", "expected_using_provider_type"),
    [
        (True, False, False, ProviderType.SYSTEM),
        (False, False, False, ProviderType.SYSTEM),
        (False, True, False, ProviderType.CUSTOM),
        (False, False, True, ProviderType.CUSTOM),
        (None, False, False, ProviderType.CUSTOM),
    ],
)
def test_get_configurations_resolves_system_preference_with_quota_and_custom_fallback(
    mock_provider_entity: ProviderEntity,
    quota_is_valid: bool | None,
    has_custom_provider: bool,
    has_custom_model: bool,
    expected_using_provider_type: ProviderType,
) -> None:
    manager = _build_provider_manager()
    provider_configuration = Mock()
    provider_factory = Mock()
    provider_factory.get_providers.return_value = [mock_provider_entity]
    custom_configuration = SimpleNamespace(
        provider=Mock() if has_custom_provider else None,
        models=[Mock()] if has_custom_model else [],
    )
    system_configuration = SimpleNamespace(
        enabled=True,
        quota_configurations=[] if quota_is_valid is None else [SimpleNamespace(is_valid=quota_is_valid)],
        current_quota_type=None,
    )
    preferred_provider_records = {
        "openai": SimpleNamespace(preferred_provider_type=ProviderType.SYSTEM),
    }

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}),
        patch.object(manager, "_init_trial_provider_records", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value=preferred_provider_records),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_system_configuration", return_value=system_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch("core.provider_manager.ModelProviderFactory", return_value=provider_factory),
        patch(
            "core.provider_manager.ProviderConfiguration",
            return_value=provider_configuration,
        ) as mock_provider_configuration,
    ):
        manager.get_configurations("tenant-id")

    assert mock_provider_configuration.call_args.kwargs["using_provider_type"] == expected_using_provider_type


def test_get_configurations_reuses_cached_result_for_same_tenant(mock_provider_entity: ProviderEntity) -> None:
    manager = _build_provider_manager()

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}) as mock_get_all_providers,
        patch.object(manager, "_init_trial_provider_records", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager._model_runtime, "fetch_model_providers", return_value=[mock_provider_entity]),
    ):
        first = manager.get_configurations("tenant-id")
        second = manager.get_configurations("tenant-id")

    assert first is second
    mock_get_all_providers.assert_called_once_with("tenant-id")
    assert first["openai"]._bound_model_runtime is manager._model_runtime


def test_clear_configurations_cache_rebuilds_requested_tenant(mock_provider_entity: ProviderEntity) -> None:
    manager = _build_provider_manager()

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}) as mock_get_all_providers,
        patch.object(manager, "_init_trial_provider_records", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager._model_runtime, "fetch_model_providers", return_value=[mock_provider_entity]),
    ):
        first = manager.get_configurations("tenant-id")
        manager.clear_configurations_cache("tenant-id")
        second = manager.get_configurations("tenant-id")

    assert first is not second
    assert first["openai"] is not second["openai"]
    assert mock_get_all_providers.call_count == 2
    assert first["openai"]._bound_model_runtime is manager._model_runtime
    assert second["openai"]._bound_model_runtime is manager._model_runtime


def test_get_provider_model_bundle_returns_selected_model_type_instance() -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(provider="openai", models=["gpt-4"], configured=True),
    )

    result = manager.get_provider_model_bundle("tenant-id", "openai", ModelType.LLM)

    assert isinstance(result, ProviderModelBundle)
    assert isinstance(result.configuration, ProviderConfiguration)
    assert result.configuration.provider.provider == "openai"
    assert isinstance(result.model_type_instance, LargeLanguageModel)
    assert result.model_type_instance.model_type == ModelType.LLM
    assert result.model_type_instance.provider == "openai"
    assert result.model_type_instance.model_runtime is manager._model_runtime


def _fallback_provider_configuration(
    *,
    provider: str,
    models: list[str],
    configured: bool,
    disabled_models: tuple[str, ...] = (),
    model_type: ModelType = ModelType.LLM,
) -> ProviderConfiguration:
    """Build a real local provider catalog; predefined schemas require no plugin requests."""
    return _fallback_multi_type_provider_configuration(
        provider=provider,
        models=[(model, model_type) for model in models],
        configured=configured,
        disabled_models=[(model, model_type) for model in disabled_models],
    )


def _fallback_multi_type_provider_configuration(
    *,
    provider: str,
    models: list[tuple[str, ModelType]],
    configured: bool,
    disabled_models: list[tuple[str, ModelType]] | None = None,
) -> ProviderConfiguration:
    """Build one real provider catalog entry that serves several model types at once."""
    supported_model_types = list(dict.fromkeys(model_type for _, model_type in models))
    return ProviderConfiguration(
        tenant_id="tenant-id",
        provider=ProviderEntity(
            provider=provider,
            label=I18nObject(en_US=provider),
            supported_model_types=supported_model_types,
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            models=[
                AIModelEntity(
                    model=model,
                    label=I18nObject(en_US=model),
                    model_type=model_type,
                    fetch_from=FetchFrom.PREDEFINED_MODEL,
                    model_properties={},
                )
                for model, model_type in models
            ],
        ),
        preferred_provider_type=ProviderType.CUSTOM,
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SystemConfiguration(enabled=False),
        custom_configuration=CustomConfiguration(
            provider=CustomProviderConfiguration(credentials={"api_key": "synthetic"}) if configured else None
        ),
        model_settings=[
            ModelSettings(model=model, model_type=model_type, enabled=False)
            for model, model_type in disabled_models or []
        ],
    )


def _fallback_provider_manager(*configurations: ProviderConfiguration) -> ProviderManager:
    """Use the real request cache and catalog filtering without DB or plugin I/O."""
    manager = ProviderManager(model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"))
    catalog = ProviderConfigurations(tenant_id="tenant-id")
    for configuration in configurations:
        configuration.bind_model_runtime(manager._model_runtime)
        catalog[str(ModelProviderID(configuration.provider.provider))] = configuration
    manager._configurations_cache["tenant-id"] = catalog
    return manager


def test_get_first_provider_first_model_returns_none_when_no_models() -> None:
    manager = _fallback_provider_manager()

    assert manager.get_first_provider_first_model("tenant-id", ModelType.LLM) == (None, None)


@pytest.mark.parametrize(("configured", "disabled"), [(False, ()), (True, ("unavailable",))])
def test_get_first_provider_first_model_returns_none_when_no_active_models(
    configured: bool, disabled: tuple[str, ...]
) -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(
            provider="langgenius/openai/openai",
            models=["unavailable"],
            configured=configured,
            disabled_models=disabled,
        )
    )

    assert manager.get_first_provider_first_model("tenant-id", ModelType.LLM) == (None, None)


def test_get_first_provider_first_model_skips_unconfigured_provider() -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(provider="langgenius/x/x", models=["unconfigured-first"], configured=False),
        _fallback_provider_configuration(
            provider="langgenius/openai/openai", models=["active-second"], configured=True
        ),
    )

    assert manager.get_first_provider_first_model("tenant-id", ModelType.LLM) == (
        "langgenius/openai/openai",
        "active-second",
    )


def test_get_first_provider_first_model_skips_disabled_model() -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(
            provider="langgenius/openai/openai",
            models=["disabled-first", "active-second", "active-third"],
            configured=True,
            disabled_models=("disabled-first",),
        )
    )

    assert manager.get_first_provider_first_model("tenant-id", ModelType.LLM) == (
        "langgenius/openai/openai",
        "active-second",
    )


def test_update_default_model_record_raises_for_unknown_provider() -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(provider="openai", models=["gpt-4"], configured=True),
    )

    with pytest.raises(ValueError, match="Provider anthropic does not exist."):
        manager.update_default_model_record("tenant-id", ModelType.LLM, "anthropic", "claude-3-sonnet")


def test_update_default_model_record_raises_for_unknown_model() -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(provider="openai", models=["gpt-4"], configured=True),
    )

    with pytest.raises(ValueError, match="Model gpt-3.5-turbo does not exist."):
        manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-3.5-turbo")


def test_update_default_model_record_updates_existing_record(sqlite_session: Session) -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(provider="openai", models=["gpt-3.5-turbo"], configured=True),
    )
    existing_default_model = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="anthropic",
        model_name="claude-3-sonnet",
        model_type=ModelType.LLM,
    )
    other_tenant_default = TenantDefaultModel(
        tenant_id="other-tenant",
        provider_name="cohere",
        model_name="command-r",
        model_type=ModelType.LLM,
    )
    sqlite_session.add_all([existing_default_model, other_tenant_default])
    sqlite_session.commit()

    result = manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-3.5-turbo")

    assert result.id == existing_default_model.id
    assert result.provider_name == "openai"
    assert result.model_name == "gpt-3.5-turbo"
    sqlite_session.expire_all()
    persisted_default = sqlite_session.get(TenantDefaultModel, existing_default_model.id)
    assert persisted_default is not None
    assert persisted_default.provider_name == "openai"
    persisted_other_default = sqlite_session.get(TenantDefaultModel, other_tenant_default.id)
    assert persisted_other_default is not None
    assert persisted_other_default.provider_name == "cohere"
    assert persisted_other_default.model_name == "command-r"


def test_update_default_model_record_creates_record_with_origin_model_type(sqlite_session: Session) -> None:
    manager = _fallback_provider_manager(
        _fallback_provider_configuration(provider="openai", models=["gpt-4"], configured=True),
    )
    sqlite_session.add(
        TenantDefaultModel(
            tenant_id="other-tenant",
            provider_name="anthropic",
            model_name="claude",
            model_type=ModelType.LLM,
        )
    )
    sqlite_session.commit()

    result = manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")

    assert result.tenant_id == "tenant-id"
    assert result.provider_name == "openai"
    assert result.model_name == "gpt-4"
    assert result.model_type == ModelType.LLM
    persisted_defaults = list(sqlite_session.scalars(select(TenantDefaultModel)).all())
    assert {record.tenant_id for record in persisted_defaults} == {"tenant-id", "other-tenant"}


def test_get_default_model_leaves_no_connection_checked_out(sqlite_session: Session, sqlite_engine: Engine) -> None:
    sqlite_session.add(
        TenantDefaultModel(
            tenant_id="other-tenant",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
        )
    )
    sqlite_session.commit()

    result = _build_provider_manager().get_default_model("tenant-id", ModelType.LLM)

    assert result is None
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    assert pool.checkedout() == 0


def test_update_default_model_record_does_not_commit_the_callers_pending_work(sqlite_session: Session) -> None:
    manager = _build_provider_manager()
    sqlite_session.add(
        TenantDefaultModel(
            tenant_id="other-tenant",
            provider_name="anthropic",
            model_name="claude",
            model_type=ModelType.LLM,
        )
    )

    with (
        patch.object(manager, "get_configurations", return_value={}),
        patch.object(manager, "_validate_default_model"),
    ):
        manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")

    sqlite_session.rollback()
    persisted = {
        (record.tenant_id, record.provider_name, record.model_name)
        for record in sqlite_session.scalars(select(TenantDefaultModel))
    }
    assert persisted == {("tenant-id", "openai", "gpt-4")}


@pytest.mark.parametrize("clear_all", [False, True])
def test_replace_default_model_records_removes_omitted_types_only_for_current_tenant(
    sqlite_session: Session, clear_all: bool
) -> None:
    existing_default = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="anthropic",
        model_name="claude-3-sonnet",
        model_type=ModelType.LLM,
    )
    omitted_default = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="text-embedding-3-small",
        model_type=ModelType.TEXT_EMBEDDING,
    )
    other_tenant_default = TenantDefaultModel(
        tenant_id="other-tenant",
        provider_name="openai",
        model_name="text-embedding-3-small",
        model_type=ModelType.TEXT_EMBEDDING,
    )
    sqlite_session.add_all([existing_default, omitted_default, other_tenant_default])
    sqlite_session.commit()
    manager = _fallback_provider_manager(
        _fallback_multi_type_provider_configuration(
            provider="openai",
            models=[("gpt-4", ModelType.LLM), ("text-embedding-3-small", ModelType.TEXT_EMBEDDING)],
            configured=True,
        ),
        _fallback_provider_configuration(
            provider="cohere", models=["rerank-v3"], configured=True, model_type=ModelType.RERANK
        ),
    )
    settings = (
        []
        if clear_all
        else [
            DefaultModelSetting(model_type=ModelType.LLM, provider="openai", model="gpt-4"),
            DefaultModelSetting(model_type=ModelType.RERANK, provider="cohere", model="rerank-v3"),
        ]
    )

    manager.replace_default_model_records("tenant-id", settings)
    sqlite_session.expire_all()
    for _ in range(2):
        assert manager.get_default_model("tenant-id", ModelType.TEXT_EMBEDDING) is None

    sqlite_session.expire_all()
    defaults = list(sqlite_session.scalars(select(TenantDefaultModel)))
    expected_defaults = {("other-tenant", ModelType.TEXT_EMBEDDING, "openai", "text-embedding-3-small")}
    expected_defaults.update(("tenant-id", setting.model_type, setting.provider, setting.model) for setting in settings)
    assert {
        (record.tenant_id, record.model_type, record.provider_name, record.model_name) for record in defaults
    } == expected_defaults
    if not clear_all:
        persisted_default = sqlite_session.get(TenantDefaultModel, existing_default.id)
        assert persisted_default is not None
        assert persisted_default.model_name == "gpt-4"


@pytest.mark.parametrize(
    ("provider", "model", "error"),
    [
        ("missing-provider", "text-embedding-3-small", "Provider missing-provider does not exist"),
        ("openai", "missing-model", "Model missing-model does not exist"),
    ],
)
def test_replace_default_model_records_preserves_defaults_when_validation_fails(
    sqlite_session: Session, provider: str, model: str, error: str
) -> None:
    manager = _build_provider_manager()
    existing_defaults = [
        TenantDefaultModel(
            tenant_id="tenant-id", provider_name="anthropic", model_name="claude-3-sonnet", model_type=ModelType.LLM
        ),
        TenantDefaultModel(
            tenant_id="tenant-id", provider_name="cohere", model_name="rerank-v3", model_type=ModelType.RERANK
        ),
    ]
    sqlite_session.add_all(existing_defaults)
    sqlite_session.commit()
    original_defaults = {(record.id, record.provider_name, record.model_name) for record in existing_defaults}
    configurations = MagicMock()
    configurations.__contains__.side_effect = lambda name: name == "openai"
    configurations.get_models.side_effect = lambda model_type, **_kwargs: {
        ModelType.LLM: [Mock(model="gpt-4")],
        ModelType.TEXT_EMBEDDING: [Mock(model="text-embedding-3-small")],
    }[model_type]

    with (
        patch.object(manager, "get_configurations", return_value=configurations),
        pytest.raises(ValueError, match=error),
    ):
        manager.replace_default_model_records(
            "tenant-id",
            [
                DefaultModelSetting(model_type=ModelType.LLM, provider="openai", model="gpt-4"),
                DefaultModelSetting(model_type=ModelType.TEXT_EMBEDDING, provider=provider, model=model),
            ],
        )

    sqlite_session.expire_all()
    assert {
        (record.id, record.provider_name, record.model_name)
        for record in sqlite_session.scalars(select(TenantDefaultModel))
    } == original_defaults


def test_replace_default_model_records_rolls_back_when_persistence_fails(sqlite_session: Session) -> None:
    manager = _fallback_provider_manager(
        _fallback_multi_type_provider_configuration(
            provider="openai",
            models=[("gpt-4", ModelType.LLM), ("text-embedding-3-small", ModelType.TEXT_EMBEDDING)],
            configured=True,
        ),
    )
    existing_defaults = [
        TenantDefaultModel(
            tenant_id="tenant-id", provider_name="anthropic", model_name="claude-3-sonnet", model_type=ModelType.LLM
        ),
        TenantDefaultModel(
            tenant_id="tenant-id", provider_name="cohere", model_name="rerank-v3", model_type=ModelType.RERANK
        ),
    ]
    sqlite_session.add_all(existing_defaults)
    sqlite_session.commit()
    original_defaults = {(record.id, record.provider_name, record.model_name) for record in existing_defaults}

    def fail_after_flush(_session: Session, _flush_context: object) -> None:
        raise RuntimeError("Persistence failed")

    with Session(bind=sqlite_session.get_bind()) as write_session:
        event.listen(write_session, "after_flush", fail_after_flush)
        with (
            patch.object(provider_manager_module.session_factory, "create_session", return_value=write_session),
            pytest.raises(RuntimeError, match="Persistence failed"),
        ):
            manager.replace_default_model_records(
                "tenant-id",
                [
                    DefaultModelSetting(model_type=ModelType.LLM, provider="openai", model="gpt-4"),
                    DefaultModelSetting(
                        model_type=ModelType.TEXT_EMBEDDING, provider="openai", model="text-embedding-3-small"
                    ),
                ],
            )

    sqlite_session.expire_all()
    assert {
        (record.id, record.provider_name, record.model_name)
        for record in sqlite_session.scalars(select(TenantDefaultModel))
    } == original_defaults


def test_get_all_providers_normalizes_provider_names_with_model_provider_id(sqlite_session: Session) -> None:
    openai_provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    gemini_provider = Provider(
        tenant_id="tenant-id",
        provider_name="langgenius/gemini/google",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    other_tenant_provider = Provider(
        tenant_id="other-tenant",
        provider_name="anthropic",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    sqlite_session.add_all([openai_provider, gemini_provider, other_tenant_provider])
    sqlite_session.commit()

    result = ProviderManager._get_all_providers("tenant-id")

    assert list(result[str(ModelProviderID("openai"))]) == [openai_provider]
    assert list(result[str(ModelProviderID("langgenius/gemini/google"))]) == [gemini_provider]
    assert str(ModelProviderID("anthropic")) not in result


def test_get_all_providers_attaches_active_credentials(sqlite_session: Session) -> None:
    provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
        credential_id="credential-id",
    )
    credential = ProviderCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential.id = "credential-id"
    sqlite_session.add_all(
        [
            provider,
            credential,
            Provider(
                tenant_id="other-tenant",
                provider_name="anthropic",
                provider_type=ProviderType.CUSTOM,
                is_valid=True,
            ),
        ]
    )
    sqlite_session.commit()

    result = ProviderManager._get_all_providers("tenant-id")

    assert result[str(ModelProviderID("openai"))][0].credential_name == "primary"
    assert result[str(ModelProviderID("openai"))][0].encrypted_config == '{"api_key": "secret"}'
    assert str(ModelProviderID("anthropic")) not in result


def _init_openai_trial_provider_records(session_maker: sessionmaker[Session]) -> dict[str, list[Provider]]:
    return ProviderManager._init_trial_provider_records(
        "tenant-id",
        defaultdict(list),
        hosting_providers={"openai": _build_hosting_provider()},
        session_maker=session_maker,
    )


def test_init_trial_provider_records_attaches_credential_of_concurrently_created_record(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    existing_provider = _build_trial_provider_record()
    existing_provider.credential_id = "credential-id"
    credential = ProviderCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential.id = "credential-id"
    sqlite_session.add_all([existing_provider, credential])
    sqlite_session.commit()

    result = _init_openai_trial_provider_records(sqlite_session_factory)

    assert result["openai"][0].encrypted_config == '{"api_key": "secret"}'


def _build_unrelated_provider_record() -> Provider:
    return Provider(tenant_id="other-tenant", provider_name="anthropic", provider_type=ProviderType.CUSTOM)


def test_init_trial_provider_records_does_not_commit_the_callers_pending_work(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    sqlite_session.add(_build_unrelated_provider_record())

    result = _init_openai_trial_provider_records(sqlite_session_factory)

    sqlite_session.rollback()
    persisted = {
        (record.tenant_id, record.provider_name, record.quota_type)
        for record in sqlite_session.scalars(select(Provider))
    }
    assert persisted == {("tenant-id", "openai", ProviderQuotaType.TRIAL)}
    assert [record.quota_type for record in result["openai"]] == [ProviderQuotaType.TRIAL]


def test_init_trial_provider_records_conflict_keeps_the_callers_pending_work(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    sqlite_session.add(_build_trial_provider_record())
    sqlite_session.commit()
    unrelated_provider = _build_unrelated_provider_record()
    sqlite_session.add(unrelated_provider)

    _init_openai_trial_provider_records(sqlite_session_factory)

    assert unrelated_provider in sqlite_session.new
    sqlite_session.commit()
    assert sqlite_session.scalar(select(Provider).where(Provider.tenant_id == "other-tenant")) is not None


def test_init_trial_provider_records_revives_invalid_existing_record(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    existing_provider = _build_trial_provider_record()
    existing_provider.is_valid = False
    sqlite_session.add(existing_provider)
    sqlite_session.commit()

    result = _init_openai_trial_provider_records(sqlite_session_factory)

    assert [record.id for record in result["openai"]] == [existing_provider.id]
    sqlite_session.expire_all()
    stored_provider = sqlite_session.get(Provider, existing_provider.id)
    assert stored_provider is not None
    assert stored_provider.is_valid


def test_init_trial_provider_records_skips_conflict_whose_record_was_deleted_concurrently(
    sqlite_session: Session, sqlite_engine: Engine
) -> None:
    sqlite_session.add(_build_trial_provider_record())
    sqlite_session.commit()
    trial_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    def delete_conflicting_record(_session: Session) -> None:
        # Another worker removes the record between the conflicting insert and the lookup.
        with sqlite_session.begin():
            sqlite_session.execute(delete(Provider).where(Provider.tenant_id == "tenant-id"))

    event.listen(trial_session_maker, "after_rollback", delete_conflicting_record, once=True)

    result = _init_openai_trial_provider_records(trial_session_maker)

    assert result == {}
    assert sqlite_session.scalars(select(Provider)).all() == []


def test_invalidate_configurations_cache_bumps_selected_source_version() -> None:
    fake_redis = _FakeRedis()

    with patch("core.provider_manager.redis_client", fake_redis):
        ProviderManager.invalidate_configurations_cache(
            "tenant-id",
            sources=(ProviderConfigurationCacheSource.PROVIDER_CREDENTIALS,),
        )
        ProviderManager.invalidate_configurations_cache(
            "tenant-id",
            sources=(ProviderConfigurationCacheSource.PROVIDER_CREDENTIALS,),
        )

    assert fake_redis.store["provider_configurations:tenant:tenant-id:source:provider_credentials:version"] == "2"
    assert fake_redis.expirations["provider_configurations:tenant:tenant-id:source:provider_credentials:version"] == 360
    assert "provider_configurations:tenant:tenant-id:source:provider_models:version" not in fake_redis.store


def test_provider_model_credentials_cache_returns_cache_entries(sqlite_session: Session, sqlite_engine: Engine) -> None:
    fake_redis = _FakeRedis()
    credential_record = ProviderModelCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential_record.id = "credential-id"
    sqlite_session.add_all(
        [
            credential_record,
            ProviderModelCredential(
                tenant_id="other-tenant",
                provider_name="anthropic",
                model_name="claude",
                model_type=ModelType.LLM,
                credential_name="other",
                encrypted_config='{"api_key": "other"}',
            ),
        ]
    )
    sqlite_session.commit()

    credential_query_count = 0

    def count_credential_queries(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        nonlocal credential_query_count
        if statement.lstrip().upper().startswith("SELECT") and "provider_model_credentials" in statement:
            credential_query_count += 1

    # Count real SQL statements now that this test uses SQLite instead of a mocked session.
    event.listen(sqlite_engine, "before_cursor_execute", count_credential_queries)
    try:
        with patch("core.provider_manager.redis_client", fake_redis):
            first = ProviderManager._get_all_provider_model_credentials("tenant-id")
            second = ProviderManager._get_all_provider_model_credentials("tenant-id")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", count_credential_queries)

    version_key = "provider_configurations:tenant:tenant-id:source:provider_model_credentials:version"
    assert credential_query_count == 1
    assert fake_redis.expirations[version_key] == 360
    assert first["openai"][0] is not credential_record
    assert second["openai"][0].credential_name == "primary"
    assert second["openai"][0].model_type == ModelType.LLM
    assert "anthropic" not in second


def test_provider_model_cache_entries_resolve_credentials_through_owned_session(sqlite_session: Session) -> None:
    credential = ProviderModelCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential.id = "credential-id"

    def build_model(model_name: str, credential_id: str | None) -> ProviderModel:
        return ProviderModel(
            tenant_id="tenant-id",
            provider_name="openai",
            model_name=model_name,
            model_type=ModelType.LLM,
            credential_id=credential_id,
            is_valid=True,
        )

    sqlite_session.add_all(
        [
            credential,
            build_model("active", "credential-id"),
            build_model("dangling", "deleted-credential-id"),
            build_model("unset", None),
        ]
    )
    sqlite_session.commit()

    entries = {
        entry.model_name: entry for entry in provider_manager_module._load_provider_model_cache_entries("tenant-id")
    }

    assert (entries["active"].credential_name, entries["active"].encrypted_config) == (
        "primary",
        '{"api_key": "secret"}',
    )
    assert entries["dangling"].credential_id == "deleted-credential-id"
    assert (entries["dangling"].credential_name, entries["dangling"].encrypted_config) == (None, None)
    assert (entries["unset"].credential_name, entries["unset"].encrypted_config) == (None, None)


def test_provider_configuration_cache_skips_write_when_version_changes_during_load(
    sqlite_session: Session, sqlite_engine: Engine
) -> None:
    fake_redis = _FakeRedis()
    version_key = "provider_configurations:tenant:tenant-id:source:provider_model_credentials:version"
    credential_record = ProviderModelCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential_record.id = "credential-id"
    sqlite_session.add(credential_record)
    sqlite_session.commit()
    version_bumped = False

    def bump_version_on_credential_query(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        nonlocal version_bumped
        if (
            not version_bumped
            and statement.lstrip().upper().startswith("SELECT")
            and "provider_model_credentials" in statement
        ):
            version_bumped = True
            fake_redis.incr(version_key)

    event.listen(sqlite_engine, "before_cursor_execute", bump_version_on_credential_query)
    try:
        with patch("core.provider_manager.redis_client", fake_redis):
            result = ProviderManager._get_all_provider_model_credentials("tenant-id")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", bump_version_on_credential_query)

    assert version_bumped
    assert fake_redis.store[version_key] == "1"
    assert "provider_configurations:v2:tenant:tenant-id:source:provider_model_credentials:v:0" not in fake_redis.store
    assert "provider_configurations:v2:tenant:tenant-id:source:provider_model_credentials:v:1" not in fake_redis.store
    assert result["openai"][0].credential_name == "primary"


@pytest.mark.parametrize(
    "method_name",
    [
        "_get_all_provider_models",
        "_get_all_provider_model_settings",
        "_get_all_provider_model_credentials",
        "_get_all_provider_credentials",
    ],
)
def test_provider_grouping_helpers_group_records_by_provider_name(method_name: str, sqlite_session: Session) -> None:
    def build_record(
        provider_name: str, index: int, *, tenant_id: str = "tenant-id"
    ) -> Provider | ProviderModel | ProviderModelSetting | ProviderModelCredential | ProviderCredential:
        match method_name:
            case "_get_all_provider_models":
                record = ProviderModel(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    model_name=f"model-{index}",
                    model_type=ModelType.LLM,
                    credential_id=None,
                    is_valid=True,
                )
            case "_get_all_provider_model_settings":
                record = ProviderModelSetting(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    model_name=f"model-{index}",
                    model_type=ModelType.LLM,
                    enabled=True,
                    load_balancing_enabled=False,
                )
            case "_get_all_provider_model_credentials":
                record = ProviderModelCredential(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    model_name=f"model-{index}",
                    model_type=ModelType.LLM,
                    credential_name=f"credential-{index}",
                    encrypted_config='{"api_key": "secret"}',
                )
            case "_get_all_provider_credentials":
                record = ProviderCredential(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    credential_name=f"credential-{index}",
                    encrypted_config='{"api_key": "secret"}',
                )
            case _:
                raise AssertionError(f"Unexpected method: {method_name}")
        record.id = f"record-{index}"
        return record

    openai_primary = build_record("openai", 1)
    openai_secondary = build_record("openai", 2)
    anthropic_record = build_record("anthropic", 3)
    other_tenant_record = build_record("other-provider", 4, tenant_id="other-tenant")
    sqlite_session.add_all([openai_primary, openai_secondary, anthropic_record, other_tenant_record])
    sqlite_session.commit()

    with patch("core.provider_manager.redis_client", _FakeRedis()):
        result = getattr(ProviderManager, method_name)("tenant-id")

    assert [record.provider_name for record in result["openai"]] == ["openai", "openai"]
    assert [record.provider_name for record in result["anthropic"]] == ["anthropic"]
    assert "other-provider" not in result


def test_get_all_preferred_model_providers_returns_mapping_by_provider_name(sqlite_session: Session) -> None:
    openai_preference = TenantPreferredModelProvider(
        tenant_id="tenant-id", provider_name="openai", preferred_provider_type=ProviderType.SYSTEM
    )
    anthropic_preference = TenantPreferredModelProvider(
        tenant_id="tenant-id", provider_name="anthropic", preferred_provider_type=ProviderType.CUSTOM
    )
    sqlite_session.add_all(
        [
            openai_preference,
            anthropic_preference,
            TenantPreferredModelProvider(
                tenant_id="other-tenant",
                provider_name="other-provider",
                preferred_provider_type=ProviderType.SYSTEM,
            ),
        ]
    )
    sqlite_session.commit()

    with patch("core.provider_manager.redis_client", _FakeRedis()):
        result = ProviderManager._get_all_preferred_model_providers("tenant-id")

    assert result["openai"].preferred_provider_type == ProviderType.SYSTEM
    assert result["anthropic"].preferred_provider_type == ProviderType.CUSTOM
    assert "other-provider" not in result


@pytest.mark.usefixtures("sqlite_session")
def test_get_all_provider_load_balancing_configs_returns_empty_when_cached_flag_is_disabled(
    sqlite_engine: Engine,
) -> None:
    statements: list[str] = []

    def record_statement(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        with (
            patch("core.provider_manager.redis_client.get", return_value=b"False"),
            patch("core.provider_manager.FeatureService.get_features") as mock_get_features,
        ):
            result = ProviderManager._get_all_provider_load_balancing_configs("tenant-id")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert result == {}
    mock_get_features.assert_not_called()
    assert statements == []


def test_get_all_provider_load_balancing_configs_populates_cache_and_groups_configs(sqlite_session: Session) -> None:
    openai_config = LoadBalancingModelConfig(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        name="primary",
        encrypted_config=None,
        credential_id=None,
        credential_source_type=None,
        enabled=True,
    )
    openai_config.id = "lb-1"
    anthropic_config = LoadBalancingModelConfig(
        tenant_id="tenant-id",
        provider_name="anthropic",
        model_name="claude",
        model_type=ModelType.LLM,
        name="primary",
        encrypted_config=None,
        credential_id=None,
        credential_source_type=None,
        enabled=True,
    )
    anthropic_config.id = "lb-2"
    other_tenant_config = LoadBalancingModelConfig(
        tenant_id="other-tenant",
        provider_name="other-provider",
        model_name="other-model",
        model_type=ModelType.LLM,
        name="primary",
        encrypted_config=None,
        credential_id=None,
        credential_source_type=None,
        enabled=True,
    )
    sqlite_session.add_all([openai_config, anthropic_config, other_tenant_config])
    sqlite_session.commit()

    with (
        patch("core.provider_manager.redis_client.get", return_value=None),
        patch("core.provider_manager.redis_client.setex") as mock_setex,
        patch(
            "core.provider_manager.FeatureService.get_features",
            return_value=FeatureModel(model_load_balancing_enabled=True),
        ),
    ):
        result = ProviderManager._get_all_provider_load_balancing_configs("tenant-id")

    mock_setex.assert_any_call("tenant:tenant-id:model_load_balancing_enabled", 120, "True")
    assert [record.provider_name for record in result["openai"]] == ["openai"]
    assert [record.provider_name for record in result["anthropic"]] == ["anthropic"]
    assert "other-provider" not in result
