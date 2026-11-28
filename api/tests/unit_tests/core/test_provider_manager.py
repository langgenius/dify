import json
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, PropertyMock, patch

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core import provider_manager as provider_manager_module
from core.entities.model_entities import (
    DefaultModelSetting,
    ModelStatus,
    ModelWithProviderEntity,
    SimpleModelProviderEntity,
)
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import (
    CustomConfiguration,
    CustomProviderConfiguration,
    ModelSettings,
    ProviderQuotaType,
    SystemConfiguration,
)
from core.errors.error import ProviderTokenNotInitError
from core.helper import model_provider_cache
from core.helper.encrypter import encrypt_token
from core.helper.model_provider_cache import ProviderCredentialsCacheType
from core.hosting_configuration import (
    FreeHostingQuota,
    HostingConfiguration,
    HostingProvider,
    PaidHostingQuota,
    TrialHostingQuota,
)
from core.model_manager import ModelManager
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.provider_manager import ProviderConfigurationCacheSource, ProviderManager
from enums import CloudPlan, DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FormType,
    ProviderCredentialSchema,
    ProviderEntity,
)
from libs.key_providers import generate_key_pair
from models.account import Tenant
from models.engine import db
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
from services.billing_client import billing
from services.credit_pool_service import FEATURE_KEY_CREDIT_POOL, CreditPoolBalance
from services.feature_service import ProviderCatalogBilling
from tests.helpers.billing_builders import subscription_info
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.redis_commands import RedisCommandEmulator


def _build_provider_manager(session_maker: sessionmaker[Session]) -> ProviderManager:
    return ProviderManager(
        model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"), session_maker=session_maker
    )


def _persist_model_configuration(
    session: Session,
    setting: ProviderModelSetting,
    load_balancing_configs: list[LoadBalancingModelConfig],
) -> tuple[list[ProviderModelSetting], list[LoadBalancingModelConfig]]:
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
    return settings, configs


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


def _build_dual_pool_hosting_provider() -> HostingProvider:
    return HostingProvider(
        enabled=True,
        credentials={"api_key": "system-secret"},
        quotas=[TrialHostingQuota(quota_limit=100), PaidHostingQuota()],
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

    def get(self, key: str):
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
def mock_provider_entity():
    mock_entity = Mock()
    mock_entity.provider = "openai"
    mock_entity.configurate_methods = ["predefined-model"]
    mock_entity.supported_model_types = [ModelType.LLM]

    # Use PropertyMock to ensure credential_form_schemas is iterable
    provider_credential_schema = Mock()
    type(provider_credential_schema).credential_form_schemas = PropertyMock(return_value=[])
    mock_entity.provider_credential_schema = provider_credential_schema

    model_credential_schema = Mock()
    type(model_credential_schema).credential_form_schemas = PropertyMock(return_value=[])
    mock_entity.model_credential_schema = model_credential_schema

    return mock_entity


def test__to_model_settings(
    mock_provider_entity, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
):
    # Mocking the inputs
    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type="llm",
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
            model_type="llm",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
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
        provider_manager = _build_provider_manager(sqlite_session_factory)

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
def test_invalid_credentials_are_not_decrypted_or_cached(
    encrypted_config: str, sqlite_session_factory: sessionmaker[Session]
) -> None:
    manager = _build_provider_manager(sqlite_session_factory)
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
    mock_provider_entity: Mock,
    sqlite_session: Session,
    encrypted_config: str,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    setting = ProviderModelSetting(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type="llm",
        enabled=True,
        load_balancing_enabled=True,
    )
    configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant-id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name=name,
            encrypted_config=credentials,
            enabled=True,
        )
        for name, credentials in [("__inherit__", None), ("invalid", encrypted_config), ("valid", "{}")]
    ]
    settings, configs = _persist_model_configuration(sqlite_session, setting, configs)
    manager = _build_provider_manager(sqlite_session_factory)
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
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    provider_entity = _build_plugin_provider_declaration(installation_source)
    manager = _build_provider_manager(sqlite_session_factory)

    with (
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
    ):
        configuration = manager._to_system_configuration(ProviderCatalogBilling("tenant-id"), provider_entity, [])

    assert configuration.enabled is False
    assert configuration.credentials is None


def test_to_system_configuration_rejects_unverified_marketplace_provider(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager(sqlite_session_factory)

    with (
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
        patch(
            "core.plugin.plugin_service.PluginService.is_plugin_verified",
            return_value=False,
        ) as is_plugin_verified,
    ):
        configuration = manager._to_system_configuration(ProviderCatalogBilling("tenant-id"), provider_entity, [])

    assert configuration.enabled is False
    assert configuration.credentials is None
    is_plugin_verified.assert_called_once_with("tenant-id", provider_entity.plugin_unique_identifier)


def test_to_system_configuration_never_returns_hosting_credentials_for_package_with_valid_quota(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Package)
    manager = _build_provider_manager(sqlite_session_factory)

    with patch(
        "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
        {provider_entity.provider: _build_hosting_provider()},
    ):
        configuration = manager._to_system_configuration(
            ProviderCatalogBilling("tenant-id"),
            provider_entity,
            [_build_trial_provider_record()],
        )

    assert configuration.enabled is False
    assert configuration.credentials is None


@pytest.mark.parametrize(
    ("plan", "pool_type", "pool_quota_used", "pool_quota_limit", "expected_valid"),
    [
        (CloudPlan.SANDBOX, ProviderQuotaType.TRIAL, 40, 100, True),
        (CloudPlan.TEAM, ProviderQuotaType.PAID, 1200, 5000, True),
        (CloudPlan.SANDBOX, ProviderQuotaType.TRIAL, 100, 100, False),
    ],
)
def test_to_system_configuration_offers_only_the_plan_credit_pool(
    plan: CloudPlan,
    pool_type: ProviderQuotaType,
    pool_quota_used: int,
    pool_quota_limit: int,
    expected_valid: bool,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager(sqlite_session_factory)
    # The legacy provider row carries a stale balance that must never win over the pool.
    legacy_record = _build_trial_provider_record()

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_dual_pool_hosting_provider()},
        ),
        patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True),
        patch.object(billing, "subscription_get_subscription_info", return_value=subscription_info(plan)),
        patch(
            "services.credit_pool_service.CreditPoolService.get_pool",
            return_value=CreditPoolBalance(
                tenant_id="tenant-id",
                pool_type=pool_type.value,
                quota_limit=pool_quota_limit,
                quota_used=pool_quota_used,
            ),
        ) as get_pool,
    ):
        configuration = manager._to_system_configuration(
            ProviderCatalogBilling("tenant-id"), provider_entity, [legacy_record]
        )

    assert configuration.enabled is True
    assert configuration.current_quota_type == pool_type
    assert [
        (quota.quota_type, quota.quota_used, quota.quota_limit, quota.is_valid)
        for quota in configuration.quota_configurations
    ] == [(pool_type, pool_quota_used, pool_quota_limit, expected_valid)]
    get_pool.assert_called_once_with(tenant_id="tenant-id", pool_type=pool_type)


@pytest.mark.parametrize(
    ("plan", "workspace_key"), [(CloudPlan.SANDBOX, None), (CloudPlan.SANDBOX, "workspace-key"), (CloudPlan.TEAM, None)]
)
def test_paid_only_hosting_requires_a_paid_workspace(
    sqlite_session: Session,
    plan: CloudPlan,
    workspace_key: str | None,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Only a paid workspace gets hosted credentials; a sandbox must supply its own key."""
    provider = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    legacy_record = _build_trial_provider_record()
    legacy_record.quota_type = ModelProviderQuotaType.PAID
    sqlite_session.add_all(
        [
            legacy_record,
            TenantPreferredModelProvider(
                tenant_id="tenant-id", provider_name="openai", preferred_provider_type=ProviderType.SYSTEM
            ),
        ]
    )
    if workspace_key is not None:
        credential = ProviderCredential(
            tenant_id="tenant-id", provider_name="openai", credential_name="workspace", encrypted_config=workspace_key
        )
        sqlite_session.add(credential)
        sqlite_session.add(
            Provider(tenant_id="tenant-id", provider_name="openai", credential_id=credential.id, is_valid=True)
        )
    sqlite_session.commit()
    manager = ProviderManager(
        model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"), session_maker=sqlite_session_factory
    )

    with (
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
            HOSTED_OPENAI_TRIAL_ENABLED=False,
            HOSTED_OPENAI_PAID_ENABLED=True,
            HOSTED_OPENAI_PAID_MODELS="gpt-4o",
            HOSTED_OPENAI_API_KEY="hosted-key",
        ),
        patch.dict(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider.provider: HostingConfiguration().init_openai()},
        ),
        patch("core.plugin.plugin_service.PluginService.fetch_plugin_model_providers", return_value=[provider]),
        patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True),
        patch("services.billing_service.BillingService.get_info", return_value=subscription_info(plan)),
        patch(
            "services.billing_service.BillingService.quota_get_balance",
            return_value=billing.QuotaGetBalanceReply(available=100, reserved=0, quota=100, usage=0, exhausted_at=0),
        ) as get_balance,
    ):
        configuration = manager.get_configurations("tenant-id").get(provider.provider)
        assert configuration is not None
        if plan == CloudPlan.SANDBOX:
            assert configuration.system_configuration == SystemConfiguration(enabled=False)
            get_balance.assert_not_called()
            expected_key = workspace_key
        else:
            assert configuration.system_configuration.current_quota_type == ProviderQuotaType.PAID
            get_balance.assert_called_once_with(
                tenant_id="tenant-id", feature_key=FEATURE_KEY_CREDIT_POOL, bucket="paid"
            )
            expected_key = "hosted-key"

        models = ModelManager(manager)
        if expected_key is None:
            with pytest.raises(ProviderTokenNotInitError):
                models.get_model_instance("tenant-id", provider.provider, ModelType.LLM, "gpt-4o")
        else:
            instance = models.get_model_instance("tenant-id", provider.provider, ModelType.LLM, "gpt-4o")
            assert instance.credentials["openai_api_key"] == expected_key


@pytest.mark.parametrize("failed_read", ["subscription", "balance"])
def test_billing_outage_preserves_custom_credentials_and_disables_hosting(
    sqlite_session: Session,
    failed_read: str,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """One failed catalog lookup must not hide a workspace key or enable an unmetered fallback."""
    tenant_id = "tenant-id"
    provider = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    other = provider.model_copy(
        update={
            "provider": "langgenius/anthropic/anthropic",
            "plugin_unique_identifier": "langgenius/anthropic:1.0.0@checksum",
            "label": I18nObject(en_US="Anthropic"),
        }
    )
    credential = ProviderCredential(
        tenant_id=tenant_id, provider_name="openai", credential_name="workspace", encrypted_config="workspace-key"
    )
    sqlite_session.add_all(
        [
            credential,
            Provider(tenant_id=tenant_id, provider_name="openai", credential_id=credential.id, is_valid=True),
            TenantPreferredModelProvider(
                tenant_id=tenant_id, provider_name="openai", preferred_provider_type=ProviderType.SYSTEM
            ),
            ProviderModelSetting(
                tenant_id=tenant_id,
                provider_name="openai",
                model_name="gpt-4o",
                model_type=ModelType.LLM,
                load_balancing_enabled=True,
            ),
        ]
    )
    sqlite_session.commit()
    manager = ProviderManager(
        model_runtime=create_plugin_model_runtime(tenant_id=tenant_id), session_maker=sqlite_session_factory
    )
    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch.dict(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {p.provider: _build_dual_pool_hosting_provider() for p in (provider, other)},
        ),
        patch("core.plugin.plugin_service.PluginService.fetch_plugin_model_providers", return_value=[provider, other]),
        patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True),
        patch.object(
            billing,
            "subscription_get_subscription_info",
            return_value=subscription_info("team"),
            side_effect=billing.BillingSubscriptionUpstreamUnavailableError()
            if failed_read == "subscription"
            else None,
        ) as subscription,
        patch.object(
            billing, "quota_get_balance", side_effect=billing.BillingQuotaUpstreamUnavailableError()
        ) as balance,
        patch.object(billing, "quota_get_quota_info", side_effect=AssertionError("unrelated quota lookup")),
    ):
        configurations = manager.get_configurations(tenant_id)
        configured = configurations.get(provider.provider)
        assert configured is not None
        assert configured.preferred_provider_type == ProviderType.SYSTEM
        assert configured.using_provider_type == ProviderType.CUSTOM
        assert configured.system_configuration == SystemConfiguration(enabled=False)
        models = ModelManager(manager)
        assert models.get_model_instance(tenant_id, provider.provider, ModelType.LLM, "gpt-4o").credentials == {
            "openai_api_key": "workspace-key"
        }
        with pytest.raises(ProviderTokenNotInitError):
            models.get_model_instance(tenant_id, other.provider, ModelType.LLM, "claude")

    subscription.assert_called_once_with(tenant_id=tenant_id, exclude_vector_space=True)
    if failed_read == "balance":
        balance.assert_called_once_with(tenant_id=tenant_id, feature_key=FEATURE_KEY_CREDIT_POOL, bucket="paid")
    else:
        balance.assert_not_called()


@pytest.fixture
def encrypted_free_quota_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, sqlite_session: Session) -> str:
    """Encrypt a test credential with the local tenant key provider."""
    monkeypatch.setattr(storage, "storage_runner", OpenDALStorage(scheme="fs", root=str(tmp_path)), raising=False)
    monkeypatch.setattr(db, "session", sqlite_session)
    tenant = Tenant(name="Sandbox", encrypt_public_key=generate_key_pair("tenant-id"))
    tenant.id = "tenant-id"
    sqlite_session.add(tenant)
    sqlite_session.commit()
    return encrypt_token(tenant.id, "free-key")


def test_to_system_configuration_falls_back_to_free_quota_instead_of_unmetered_hosting(
    monkeypatch: pytest.MonkeyPatch,
    encrypted_free_quota_key: str,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Only the third-party row supplies credentials and quota, both before and after caching."""
    redis, commands = redis_transport
    commands.side_effect = RedisCommandEmulator()
    monkeypatch.setattr(model_provider_cache, "redis_client", redis)
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    provider_entity.provider_credential_schema = ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API key"), type=FormType.SECRET_INPUT),
            CredentialFormSchema(
                variable="optional_token", label=I18nObject(en_US="Token"), type=FormType.SECRET_INPUT, required=False
            ),
        ]
    )
    manager = ProviderManager(
        model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"), session_maker=sqlite_session_factory
    )
    hosting = HostingProvider(
        enabled=True,
        credentials={"api_key": "system-secret"},
        quotas=[PaidHostingQuota(), FreeHostingQuota()],
    )
    free_credential = ProviderCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        credential_name="free",
        encrypted_config=json.dumps({"api_key": encrypted_free_quota_key}),
    )
    free_record = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.SYSTEM,
        quota_type=ModelProviderQuotaType.FREE,
        quota_limit=10,
        quota_used=2,
        is_valid=True,
        credential_id=free_credential.id,
    )
    free_record.credential = free_credential

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: hosting},
        ),
        patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True),
        patch.object(billing, "subscription_get_subscription_info", return_value=subscription_info(CloudPlan.SANDBOX)),
        patch("services.credit_pool_service.CreditPoolService.get_pool") as get_pool,
    ):
        records = [_build_trial_provider_record(), free_record]
        configuration = manager._to_system_configuration(ProviderCatalogBilling("tenant-id"), provider_entity, records)
        cache = model_provider_cache.ProviderCredentialsCache(
            "tenant-id", free_record.id, ProviderCredentialsCacheType.PROVIDER
        )
        assert cache.get() == {"api_key": "free-key"}
        assert (
            manager._to_system_configuration(ProviderCatalogBilling("tenant-id"), provider_entity, records)
            == configuration
        )

    get_pool.assert_not_called()
    assert configuration.enabled is True
    assert configuration.credentials == {"api_key": "free-key"}
    assert configuration.current_quota_type == ProviderQuotaType.FREE
    assert [
        (quota.quota_type, quota.quota_used, quota.quota_limit, quota.is_valid)
        for quota in configuration.quota_configurations
    ] == [(ProviderQuotaType.FREE, 2, 10, True)]


def test_to_system_configuration_keeps_an_exhausted_plan_bucket_over_free_quota(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Selecting a hosted bucket is a plan decision, not a balance-based fallback."""
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager(sqlite_session_factory)
    hosting = HostingProvider(
        enabled=True,
        credentials={"api_key": "system-secret"},
        quotas=[PaidHostingQuota(), FreeHostingQuota()],
    )
    free_record = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.SYSTEM,
        quota_type=ModelProviderQuotaType.FREE,
        quota_limit=10,
        quota_used=2,
        is_valid=True,
    )

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: hosting},
        ),
        patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True),
        patch.object(billing, "subscription_get_subscription_info", return_value=subscription_info(CloudPlan.TEAM)),
        patch(
            "services.credit_pool_service.CreditPoolService.get_pool",
            return_value=CreditPoolBalance("tenant-id", "paid", 5000, 5000),
        ),
    ):
        configuration = manager._to_system_configuration(
            ProviderCatalogBilling("tenant-id"), provider_entity, [free_record]
        )

    assert configuration.enabled is True
    assert configuration.current_quota_type == ProviderQuotaType.PAID
    assert [(quota.quota_type, quota.is_valid) for quota in configuration.quota_configurations] == [
        (ProviderQuotaType.PAID, False),
        (ProviderQuotaType.FREE, True),
    ]


@pytest.mark.parametrize(
    ("has_record", "quota_used", "quota_limit", "expected", "error"),
    [
        (False, None, None, None, None),
        (True, 2, 10, (2, 10, True), None),
        (True, 10, 10, (10, 10, False), None),
        (True, 10, -1, (10, -1, True), None),
        (True, None, 10, None, "quota_used is None"),
        (True, 2, None, None, "quota_limit is None"),
    ],
)
def test_to_system_configuration_reads_free_quota_from_provider_record(
    has_record: bool,
    quota_used: int | None,
    quota_limit: int | None,
    expected: tuple[int, int, bool] | None,
    error: str | None,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Free hosting requires a row; its quota comes from that row rather than AI credits."""
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager(sqlite_session_factory)
    hosting = HostingProvider(enabled=True, quotas=[FreeHostingQuota()])
    records = (
        [
            Provider(
                tenant_id="tenant-id",
                provider_name="openai",
                provider_type=ProviderType.SYSTEM,
                quota_type=ModelProviderQuotaType.FREE,
                quota_limit=quota_limit,
                quota_used=quota_used,
            )
        ]
        if has_record
        else []
    )

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: hosting},
        ),
        patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True),
        patch.object(billing, "subscription_get_subscription_info", return_value=subscription_info(CloudPlan.SANDBOX)),
    ):
        if error is not None:
            with pytest.raises(ValueError, match=error):
                manager._to_system_configuration(ProviderCatalogBilling("tenant-id"), provider_entity, records)
            return
        configuration = manager._to_system_configuration(ProviderCatalogBilling("tenant-id"), provider_entity, records)

    if not has_record:
        assert configuration.enabled is False
        assert configuration.quota_configurations == []
        return
    [quota] = configuration.quota_configurations
    assert quota.quota_type == ProviderQuotaType.FREE
    assert (quota.quota_used, quota.quota_limit, quota.is_valid) == expected


def test_to_system_configuration_preserves_marketplace_behavior(sqlite_session_factory: sessionmaker[Session]) -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager(sqlite_session_factory)

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_hosting_provider()},
        ),
        patch(
            "core.plugin.plugin_service.PluginService.is_plugin_verified",
            return_value=True,
        ) as is_plugin_verified,
        patch.object(billing, "subscription_get_subscription_info", return_value=subscription_info(CloudPlan.SANDBOX)),
        patch(
            "services.credit_pool_service.CreditPoolService.get_pool",
            return_value=CreditPoolBalance(
                tenant_id="tenant-id",
                pool_type=ProviderQuotaType.TRIAL.value,
                quota_limit=100,
                quota_used=0,
            ),
        ),
    ):
        configuration = manager._to_system_configuration(
            ProviderCatalogBilling("tenant-id"),
            provider_entity,
            [_build_trial_provider_record()],
        )

    assert configuration.enabled is True
    assert configuration.credentials == {"api_key": "system-secret"}
    assert configuration.current_quota_type == ProviderQuotaType.TRIAL
    is_plugin_verified.assert_called_once_with("tenant-id", provider_entity.plugin_unique_identifier)


def test_to_system_configuration_disables_hosting_without_a_credit_pool(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    provider_entity = _build_plugin_provider_declaration(PluginInstallationSource.Marketplace)
    manager = _build_provider_manager(sqlite_session_factory)

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY),
        patch(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider_entity.provider: _build_dual_pool_hosting_provider()},
        ),
        patch("core.plugin.plugin_service.PluginService.is_plugin_verified", return_value=True),
    ):
        configuration = manager._to_system_configuration(
            ProviderCatalogBilling("tenant-id"),
            provider_entity,
            [_build_trial_provider_record()],
        )

    assert configuration.enabled is False
    assert configuration.quota_configurations == []


def test_package_provider_keeps_custom_configuration_without_billing(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """A custom-only provider with no load balancing must never wait for Billing."""
    tenant_id = "tenant-id"
    provider = _build_plugin_provider_declaration(PluginInstallationSource.Package)
    credential = ProviderCredential(
        tenant_id=tenant_id, provider_name="openai", credential_name="workspace", encrypted_config="user-secret"
    )
    sqlite_session.add_all(
        [
            credential,
            Provider(tenant_id=tenant_id, provider_name="openai", credential_id=credential.id, is_valid=True),
        ]
    )
    sqlite_session.commit()
    manager = ProviderManager(
        model_runtime=create_plugin_model_runtime(tenant_id=tenant_id), session_maker=sqlite_session_factory
    )
    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch.dict(
            "core.provider_manager.ext_hosting_provider.hosting_configuration.provider_map",
            {provider.provider: _build_hosting_provider()},
        ),
        patch("core.plugin.plugin_service.PluginService.fetch_plugin_model_providers", return_value=[provider]),
        patch.object(
            billing, "subscription_get_subscription_info", side_effect=AssertionError("unexpected Billing read")
        ),
    ):
        configuration = manager.get_configurations(tenant_id).get(provider.provider)

    assert configuration is not None
    assert not configuration.system_configuration.enabled
    assert configuration.custom_configuration.provider is not None
    assert configuration.custom_configuration.provider.credentials == {"openai_api_key": "user-secret"}


def test__to_model_settings_only_one_lb(
    mock_provider_entity, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
):
    # Mocking the inputs

    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type="llm",
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
            model_type="llm",
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
        provider_manager = _build_provider_manager(sqlite_session_factory)

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


def test__to_model_settings_lb_disabled(
    mock_provider_entity, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
):
    # Mocking the inputs
    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type="llm",
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
            model_type="llm",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
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
        provider_manager = _build_provider_manager(sqlite_session_factory)

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


def test_get_default_model_uses_injected_runtime_for_existing_default_record(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
):
    existing_default_model = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
    )
    sqlite_session.add(existing_default_model)
    sqlite_session.commit()
    manager = _build_provider_manager(sqlite_session_factory)

    with (
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        mock_factory_cls.return_value.get_provider_schema.return_value = Mock(
            provider="openai",
            label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
            icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
            supported_model_types=[ModelType.LLM],
        )

        result = manager.get_default_model("tenant-id", ModelType.LLM)

    mock_factory_cls.assert_called_once_with(runtime=manager._model_runtime)
    assert result is not None
    assert result.model == "gpt-4"
    assert result.provider.provider == "openai"


def test_get_configurations_uses_injected_runtime_and_adds_provider_aliases(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
):
    manager = _build_provider_manager(sqlite_session_factory)
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
        provider_model_records = _build_provider_manager(sqlite_session_factory)._get_all_provider_models("tenant-id")
        preferred_provider_records = _build_provider_manager(sqlite_session_factory)._get_all_preferred_model_providers(
            "tenant-id"
        )
    provider_records = {"openai": [provider]}

    with (
        patch.object(manager, "_get_all_providers", return_value=provider_records),
        patch.object(manager, "_get_all_provider_models", return_value=provider_model_records),
        patch.object(manager, "_get_all_preferred_model_providers", return_value=preferred_provider_records),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        mock_factory_cls.return_value.get_providers.return_value = []

        result = manager.get_configurations("tenant-id")

    expected_alias = str(ModelProviderID("openai"))
    mock_factory_cls.assert_called_once_with(runtime=manager._model_runtime)
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
def test_get_provider_names_returns_short_and_full_aliases(provider_name: str, expected_provider_names: list[str]):
    assert ProviderManager._get_provider_names(provider_name) == expected_provider_names


def test_get_provider_model_bundle_raises_for_unknown_provider(sqlite_session_factory: sessionmaker[Session]):
    manager = _build_provider_manager(sqlite_session_factory)

    with patch.object(manager, "get_single_provider_configuration", return_value={}):
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            manager.get_provider_model_bundle("tenant-id", "openai", ModelType.LLM)


def test_get_configurations_binds_manager_runtime_to_provider_configuration(
    mock_provider_entity, sqlite_session_factory: sessionmaker[Session]
):
    manager = _build_provider_manager(sqlite_session_factory)
    provider_configuration = Mock()
    provider_factory = Mock()
    provider_factory.get_providers.return_value = [mock_provider_entity]
    custom_configuration = SimpleNamespace(provider=None, models=[])
    system_configuration = SimpleNamespace(enabled=False, quota_configurations=[], current_quota_type=None)

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_system_configuration", return_value=system_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch("core.provider_manager.ModelProviderFactory", return_value=provider_factory),
        patch("core.provider_manager.ProviderConfiguration", return_value=provider_configuration),
    ):
        manager.get_configurations("tenant-id")

    provider_configuration.bind_model_runtime.assert_called_once_with(manager._model_runtime)


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
    mock_provider_entity,
    quota_is_valid: bool | None,
    has_custom_provider: bool,
    has_custom_model: bool,
    expected_using_provider_type: ProviderType,
    sqlite_session_factory: sessionmaker[Session],
):
    manager = _build_provider_manager(sqlite_session_factory)
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


def test_get_configurations_reuses_cached_result_for_same_tenant(
    mock_provider_entity, sqlite_session_factory: sessionmaker[Session]
):
    manager = _build_provider_manager(sqlite_session_factory)
    provider_configuration = Mock()
    provider_factory = Mock()
    provider_factory.get_providers.return_value = [mock_provider_entity]
    custom_configuration = SimpleNamespace(provider=None, models=[])
    system_configuration = SimpleNamespace(enabled=False, quota_configurations=[], current_quota_type=None)

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}) as mock_get_all_providers,
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_system_configuration", return_value=system_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch("core.provider_manager.ModelProviderFactory", return_value=provider_factory) as mock_factory_cls,
        patch(
            "core.provider_manager.ProviderConfiguration",
            return_value=provider_configuration,
        ) as mock_provider_configuration,
    ):
        first = manager.get_configurations("tenant-id")
        second = manager.get_configurations("tenant-id")

    assert first is second
    mock_get_all_providers.assert_called_once_with("tenant-id")
    mock_factory_cls.assert_called_once_with(runtime=manager._model_runtime)
    mock_provider_configuration.assert_called_once()
    provider_configuration.bind_model_runtime.assert_called_once_with(manager._model_runtime)


def test_clear_configurations_cache_rebuilds_requested_tenant(
    mock_provider_entity, sqlite_session_factory: sessionmaker[Session]
):
    manager = _build_provider_manager(sqlite_session_factory)
    provider_factory = Mock()
    provider_factory.get_providers.return_value = [mock_provider_entity]
    custom_configuration = SimpleNamespace(provider=None, models=[])
    system_configuration = SimpleNamespace(enabled=False, quota_configurations=[], current_quota_type=None)
    provider_configuration_first = Mock()
    provider_configuration_second = Mock()

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}) as mock_get_all_providers,
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
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
            side_effect=[provider_configuration_first, provider_configuration_second],
        ) as mock_provider_configuration,
    ):
        first = manager.get_configurations("tenant-id")
        manager.clear_configurations_cache("tenant-id")
        second = manager.get_configurations("tenant-id")

    assert first is not second
    assert mock_get_all_providers.call_count == 2
    assert mock_provider_configuration.call_count == 2
    provider_configuration_first.bind_model_runtime.assert_called_once_with(manager._model_runtime)
    provider_configuration_second.bind_model_runtime.assert_called_once_with(manager._model_runtime)


def test_get_provider_model_bundle_returns_selected_model_type_instance(sqlite_session_factory: sessionmaker[Session]):
    manager = _build_provider_manager(sqlite_session_factory)
    provider_configuration = Mock()
    model_type_instance = Mock()
    provider_configuration.get_model_type_instance.return_value = model_type_instance
    expected_bundle = Mock()

    with (
        patch.object(manager, "get_single_provider_configuration", return_value=provider_configuration),
        patch("core.provider_manager.ProviderModelBundle", return_value=expected_bundle) as mock_bundle,
    ):
        result = manager.get_provider_model_bundle("tenant-id", "openai", ModelType.LLM)

    provider_configuration.get_model_type_instance.assert_called_once_with(ModelType.LLM)
    mock_bundle.assert_called_once_with(
        configuration=provider_configuration,
        model_type_instance=model_type_instance,
    )
    assert result is expected_bundle


def _fallback_provider_configuration(
    *,
    provider: str,
    models: list[str],
    configured: bool,
    disabled_models: tuple[str, ...] = (),
    model_type: ModelType = ModelType.LLM,
) -> ProviderConfiguration:
    """Build a real local provider catalog; predefined schemas require no plugin requests."""
    return ProviderConfiguration(
        tenant_id="tenant-id",
        provider=ProviderEntity(
            provider=provider,
            label=I18nObject(en_US=provider),
            supported_model_types=[model_type],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            models=[
                AIModelEntity(
                    model=model,
                    label=I18nObject(en_US=model),
                    model_type=model_type,
                    fetch_from=FetchFrom.PREDEFINED_MODEL,
                    model_properties={},
                )
                for model in models
            ],
        ),
        preferred_provider_type=ProviderType.CUSTOM,
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SystemConfiguration(enabled=False),
        custom_configuration=CustomConfiguration(
            provider=CustomProviderConfiguration(credentials={"api_key": "synthetic"}) if configured else None
        ),
        model_settings=[ModelSettings(model=model, model_type=model_type, enabled=False) for model in disabled_models],
    )


def _fallback_provider_manager(*configurations: ProviderConfiguration) -> ProviderManager:
    """Use the real request cache and catalog filtering without DB or plugin I/O."""
    manager = ProviderManager(
        model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"), session_maker=sessionmaker()
    )
    _seed_provider_configurations(manager, *configurations)
    return manager


def _seed_provider_configurations(manager: ProviderManager, *configurations: ProviderConfiguration) -> None:
    """Serve ``get_configurations`` from the manager's per-tenant cache instead of DB and plugin lookups."""
    catalog = ProviderConfigurations(tenant_id="tenant-id")
    for configuration in configurations:
        catalog[configuration.provider.provider] = configuration
    manager._configurations_cache["tenant-id"] = catalog


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


def test_update_default_model_record_raises_for_unknown_provider(sqlite_session_factory: sessionmaker[Session]):
    manager = _build_provider_manager(sqlite_session_factory)

    with patch.object(manager, "get_configurations", return_value={}):
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")


def test_update_default_model_record_raises_for_unknown_model(sqlite_session_factory: sessionmaker[Session]):
    manager = _build_provider_manager(sqlite_session_factory)
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-4")]

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        with pytest.raises(ValueError, match="Model gpt-3.5-turbo does not exist."):
            manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-3.5-turbo")

    provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)


def test_update_default_model_record_updates_existing_record(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
):
    manager = _build_provider_manager(sqlite_session_factory)
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-3.5-turbo")]
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

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
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


def test_update_default_model_record_creates_record_with_origin_model_type(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
):
    manager = _build_provider_manager(sqlite_session_factory)
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-4")]
    sqlite_session.add(
        TenantDefaultModel(
            tenant_id="other-tenant",
            provider_name="anthropic",
            model_name="claude",
            model_type=ModelType.LLM,
        )
    )
    sqlite_session.commit()

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        result = manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")

    assert result.tenant_id == "tenant-id"
    assert result.provider_name == "openai"
    assert result.model_name == "gpt-4"
    assert result.model_type == ModelType.LLM
    persisted_defaults = list(sqlite_session.scalars(select(TenantDefaultModel)).all())
    assert {record.tenant_id for record in persisted_defaults} == {"tenant-id", "other-tenant"}


def test_get_default_model_leaves_no_connection_checked_out(
    sqlite_session: Session, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    sqlite_session.add(
        TenantDefaultModel(
            tenant_id="other-tenant",
            provider_name="openai",
            model_name="gpt-4",
            model_type=ModelType.LLM,
        )
    )
    sqlite_session.commit()

    result = _build_provider_manager(sqlite_session_factory).get_default_model("tenant-id", ModelType.LLM)

    assert result is None
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    assert pool.checkedout() == 0


def test_update_default_model_record_does_not_commit_the_callers_pending_work(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    manager = _build_provider_manager(sqlite_session_factory)
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
    sqlite_session: Session, clear_all: bool, sqlite_session_factory: sessionmaker[Session]
) -> None:
    manager = _build_provider_manager(sqlite_session_factory)
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
    embedding_provider = _build_plugin_provider_declaration(None)
    embedding_provider.supported_model_types = [ModelType.TEXT_EMBEDDING]
    available_embedding_model = ModelWithProviderEntity(
        model="text-embedding-3-small",
        label=I18nObject(en_US="text-embedding-3-small"),
        model_type=ModelType.TEXT_EMBEDDING,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        status=ModelStatus.ACTIVE,
        provider=SimpleModelProviderEntity(embedding_provider),
    )
    configurations = MagicMock()
    configurations.__contains__.return_value = True
    configurations.get_models.side_effect = lambda model_type, **_kwargs: {
        ModelType.LLM: [Mock(model="gpt-4")],
        ModelType.RERANK: [Mock(model="rerank-v3")],
        ModelType.TEXT_EMBEDDING: [available_embedding_model],
    }[model_type]
    settings = (
        []
        if clear_all
        else [
            DefaultModelSetting(model_type=ModelType.LLM, provider="openai", model="gpt-4"),
            DefaultModelSetting(model_type=ModelType.RERANK, provider="cohere", model="rerank-v3"),
        ]
    )

    with (
        patch.object(manager, "get_configurations", return_value=configurations) as get_configurations,
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        manager.replace_default_model_records("tenant-id", settings)
        sqlite_session.expire_all()
        for _ in range(2):
            assert manager.get_default_model("tenant-id", ModelType.TEXT_EMBEDDING) is None

    mock_factory_cls.assert_not_called()

    sqlite_session.expire_all()
    defaults = list(sqlite_session.scalars(select(TenantDefaultModel)))
    expected_defaults = {("other-tenant", ModelType.TEXT_EMBEDDING, "openai", "text-embedding-3-small")}
    expected_defaults.update(("tenant-id", setting.model_type, setting.provider, setting.model) for setting in settings)
    assert {
        (record.tenant_id, record.model_type, record.provider_name, record.model_name) for record in defaults
    } == expected_defaults
    if clear_all:
        get_configurations.assert_not_called()
    else:
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
    sqlite_session: Session, provider: str, model: str, error: str, sqlite_session_factory: sessionmaker[Session]
) -> None:
    manager = _build_provider_manager(sqlite_session_factory)
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


def test_replace_default_model_records_rolls_back_when_persistence_fails(
    sqlite_session: Session, sqlite_engine: Engine
) -> None:
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

    # Every session this maker creates fails after its flush, so the write transaction must roll back.
    failing_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    event.listen(failing_session_maker, "after_flush", fail_after_flush)
    manager = _build_provider_manager(failing_session_maker)
    _seed_provider_configurations(
        manager,
        _fallback_provider_configuration(provider="langgenius/openai/openai", models=["gpt-4"], configured=True),
        _fallback_provider_configuration(
            provider="langgenius/jina/jina",
            models=["jina-embeddings-v3"],
            configured=True,
            model_type=ModelType.TEXT_EMBEDDING,
        ),
    )
    # Valid settings reach the write transaction: the LLM default is updated, the embedding default is inserted
    # and the rerank default is deleted, so every write path is rolled back together.
    with pytest.raises(RuntimeError, match="Persistence failed"):
        manager.replace_default_model_records(
            "tenant-id",
            [
                DefaultModelSetting(model_type=ModelType.LLM, provider="langgenius/openai/openai", model="gpt-4"),
                DefaultModelSetting(
                    model_type=ModelType.TEXT_EMBEDDING, provider="langgenius/jina/jina", model="jina-embeddings-v3"
                ),
            ],
        )

    sqlite_session.expire_all()
    assert {
        (record.id, record.provider_name, record.model_name)
        for record in sqlite_session.scalars(select(TenantDefaultModel))
    } == original_defaults


def test_get_all_providers_normalizes_provider_names_with_model_provider_id(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
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

    result = _build_provider_manager(sqlite_session_factory)._get_all_providers("tenant-id")

    assert list(result[str(ModelProviderID("openai"))]) == [openai_provider]
    assert list(result[str(ModelProviderID("langgenius/gemini/google"))]) == [gemini_provider]
    assert str(ModelProviderID("anthropic")) not in result


def test_get_all_providers_attaches_active_credentials(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
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

    result = _build_provider_manager(sqlite_session_factory)._get_all_providers("tenant-id")

    assert result[str(ModelProviderID("openai"))][0].credential_name == "primary"
    assert result[str(ModelProviderID("openai"))][0].encrypted_config == '{"api_key": "secret"}'
    assert str(ModelProviderID("anthropic")) not in result


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


def test_provider_model_credentials_cache_returns_cache_entries(
    sqlite_session: Session, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
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

    def count_credential_queries(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        nonlocal credential_query_count
        if statement.lstrip().upper().startswith("SELECT") and "provider_model_credentials" in statement:
            credential_query_count += 1

    # Count real SQL statements now that this test uses SQLite instead of a mocked session.
    event.listen(sqlite_engine, "before_cursor_execute", count_credential_queries)
    try:
        with patch("core.provider_manager.redis_client", fake_redis):
            first = _build_provider_manager(sqlite_session_factory)._get_all_provider_model_credentials("tenant-id")
            second = _build_provider_manager(sqlite_session_factory)._get_all_provider_model_credentials("tenant-id")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", count_credential_queries)

    version_key = "provider_configurations:tenant:tenant-id:source:provider_model_credentials:version"
    assert credential_query_count == 1
    assert fake_redis.expirations[version_key] == 360
    assert first["openai"][0] is not credential_record
    assert second["openai"][0].credential_name == "primary"
    assert second["openai"][0].model_type == ModelType.LLM
    assert "anthropic" not in second


def test_provider_model_cache_entries_resolve_credentials_through_owned_session(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
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
        entry.model_name: entry
        for entry in provider_manager_module._load_provider_model_cache_entries(sqlite_session_factory, "tenant-id")
    }

    assert (entries["active"].credential_name, entries["active"].encrypted_config) == (
        "primary",
        '{"api_key": "secret"}',
    )
    assert entries["dangling"].credential_id == "deleted-credential-id"
    assert (entries["dangling"].credential_name, entries["dangling"].encrypted_config) == (None, None)
    assert (entries["unset"].credential_name, entries["unset"].encrypted_config) == (None, None)


def test_provider_configuration_cache_skips_write_when_version_changes_during_load(
    sqlite_session: Session, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
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

    def bump_version_on_credential_query(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
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
            result = _build_provider_manager(sqlite_session_factory)._get_all_provider_model_credentials("tenant-id")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", bump_version_on_credential_query)

    assert version_bumped is True
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
def test_provider_grouping_helpers_group_records_by_provider_name(
    method_name: str, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    def build_record(provider_name: str, index: int, *, tenant_id: str = "tenant-id"):
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
        result = getattr(_build_provider_manager(sqlite_session_factory), method_name)("tenant-id")

    assert [record.provider_name for record in result["openai"]] == ["openai", "openai"]
    assert [record.provider_name for record in result["anthropic"]] == ["anthropic"]
    assert "other-provider" not in result


def test_get_all_preferred_model_providers_returns_mapping_by_provider_name(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
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
        result = _build_provider_manager(sqlite_session_factory)._get_all_preferred_model_providers("tenant-id")

    assert result["openai"].preferred_provider_type == ProviderType.SYSTEM
    assert result["anthropic"].preferred_provider_type == ProviderType.CUSTOM
    assert "other-provider" not in result


@pytest.mark.usefixtures("sqlite_session")
def test_get_all_provider_load_balancing_configs_returns_empty_when_cached_flag_is_disabled(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    statements: list[str] = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        with (
            patch("core.provider_manager.redis_client.get", return_value=b"False"),
            patch.object(billing, "subscription_get_subscription_info") as subscription,
        ):
            result = _build_provider_manager(sqlite_session_factory)._get_all_provider_load_balancing_configs(
                ProviderCatalogBilling("tenant-id")
            )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert result == {}
    subscription.assert_not_called()
    assert statements == []


def test_get_all_provider_load_balancing_configs_populates_cache_and_groups_configs(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
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
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD),
        patch.object(
            billing,
            "subscription_get_subscription_info",
            side_effect=[
                billing.BillingSubscriptionUpstreamUnavailableError(),
                subscription_info(model_load_balancing_enabled=True),
            ],
        ),
    ):
        assert (
            _build_provider_manager(sqlite_session_factory)._get_all_provider_load_balancing_configs(
                ProviderCatalogBilling("tenant-id")
            )
            == {}
        )
        mock_setex.assert_not_called()
        result = _build_provider_manager(sqlite_session_factory)._get_all_provider_load_balancing_configs(
            ProviderCatalogBilling("tenant-id")
        )

    mock_setex.assert_any_call("tenant:tenant-id:model_load_balancing_enabled", 120, "True")
    assert [record.provider_name for record in result["openai"]] == ["openai"]
    assert [record.provider_name for record in result["anthropic"]] == ["anthropic"]
    assert "other-provider" not in result


def test_get_provider_model_available_credentials_lists_matching_credentials_newest_first(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    def build_credential(
        name: str, created_at: datetime, *, provider_name: str = "openai", tenant_id: str = "tenant-id"
    ) -> ProviderModelCredential:
        credential = ProviderModelCredential(
            tenant_id=tenant_id,
            provider_name=provider_name,
            model_name="gpt-4",
            model_type=ModelType.LLM,
            credential_name=name,
            encrypted_config="{}",
        )
        credential.created_at = created_at
        return credential

    older = build_credential("older", datetime(2026, 1, 1))
    newer = build_credential("newer", datetime(2026, 1, 2), provider_name="langgenius/openai/openai")
    sqlite_session.add_all(
        [
            older,
            newer,
            build_credential("other-tenant", datetime(2026, 1, 3), tenant_id="other-tenant"),
            build_credential("other-provider", datetime(2026, 1, 3), provider_name="anthropic"),
        ]
    )
    sqlite_session.commit()

    result = _build_provider_manager(sqlite_session_factory).get_provider_model_available_credentials(
        "tenant-id", "openai", "gpt-4", ModelType.LLM.value
    )

    # Both the short and the plugin-prefixed provider names belong to the same provider.
    assert [(credential.credential_id, credential.credential_name) for credential in result] == [
        (newer.id, "newer"),
        (older.id, "older"),
    ]
