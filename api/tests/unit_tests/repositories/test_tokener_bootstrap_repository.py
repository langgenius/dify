"""Native activation uses the real provider owner, not a mocked activation switch."""

from collections.abc import Sequence
from dataclasses import dataclass

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from core.entities import provider_configuration as configuration_module
from core.entities.provider_configuration import ProviderConfiguration
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.helper.model_provider_cache import ProviderCredentialsCache
from core.provider_manager import ProviderConfigurationCacheSource, ProviderManager
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.provider import Provider, ProviderCredential, ProviderType, TenantPreferredModelProvider
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.model_provider.service import ModelProviderService
from tasks import bootstrap_tokener_tenant_task as worker

PROVIDER = "langgenius/tokener/tokener"


@dataclass(frozen=True)
class EngineOwner:
    engine: Engine


@dataclass
class ActivationCase:
    tenant_id: str
    credential_id: str
    configuration: ProviderConfiguration
    cache_deletes: list[str]
    cache_sources: list[tuple[str, tuple[ProviderConfigurationCacheSource, ...]]]


@pytest.fixture
def activation_case(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> ActivationCase:
    tenant = Tenant(name="Real native activation owner")
    sqlite_session.add(tenant)
    sqlite_session.flush()
    credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name=PROVIDER,
        credential_name="platform-bound",
        encrypted_config='{"api_key":"ENCRYPTED_UNIT_VALUE"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source="tokener"),
            TenantTokenerIntegration(
                tenant_id=tenant.id,
                status=TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER,
                provider_credential_id=credential.id,
            ),
        ]
    )
    sqlite_session.commit()
    configuration = ProviderConfiguration(
        tenant_id=tenant.id,
        provider=ProviderEntity(
            provider=PROVIDER,
            label=I18nObject(en_US="Tokener"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        ),
        preferred_provider_type=ProviderType.CUSTOM,
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SystemConfiguration(enabled=False),
        custom_configuration=CustomConfiguration(),
        model_settings=[],
    )
    result = ActivationCase(tenant.id, credential.id, configuration, [], [])

    def owned(_service: ModelProviderService, tenant_id: str, provider: str) -> ProviderConfiguration:
        assert (tenant_id, provider) == (result.tenant_id, PROVIDER)
        return configuration

    def deleted(cache: ProviderCredentialsCache) -> None:
        result.cache_deletes.append(cache.cache_key)

    def invalidated(tenant_id: str, sources: Sequence[ProviderConfigurationCacheSource] | None = None) -> None:
        result.cache_sources.append((tenant_id, tuple(sources or ())))

    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("bound activation must not provision, rotate, decrypt or revalidate a key")

    monkeypatch.setattr(configuration_module, "db", EngineOwner(sqlite_engine))
    monkeypatch.setattr(ModelProviderService, "_get_provider_configuration", owned)
    monkeypatch.setattr(ProviderCredentialsCache, "delete", deleted)
    monkeypatch.setattr(ProviderManager, "invalidate_configurations_cache", staticmethod(invalidated))
    monkeypatch.setattr(worker.BillingService, "bootstrap_tokener_tenant", forbidden)
    monkeypatch.setattr(ProviderConfiguration, "validate_provider_credentials", forbidden)
    return result


@pytest.mark.parametrize("existing", ["missing", "same", "empty"])
def test_real_native_owner_creates_or_recovers_provider_and_preference_idempotently(
    activation_case: ActivationCase,
    sqlite_session: Session,
    existing: str,
) -> None:
    case = activation_case
    if existing != "missing":
        sqlite_session.add(
            Provider(
                tenant_id=case.tenant_id,
                provider_name=PROVIDER,
                provider_type=ProviderType.CUSTOM,
                credential_id=case.credential_id if existing == "same" else None,
                is_valid=False,
            )
        )
        sqlite_session.commit()
    worker._activate_managed_credential(case.tenant_id, case.credential_id)
    worker._activate_managed_credential(case.tenant_id, case.credential_id)
    sqlite_session.expire_all()
    rows = list(sqlite_session.scalars(select(Provider).where(Provider.tenant_id == case.tenant_id)))
    assert len(rows) == 1
    assert rows[0].credential_id == case.credential_id
    assert rows[0].is_valid
    preference = sqlite_session.scalar(
        select(TenantPreferredModelProvider).where(
            TenantPreferredModelProvider.tenant_id == case.tenant_id,
        )
    )
    assert preference is not None
    assert preference.preferred_provider_type == ProviderType.CUSTOM
    assert sqlite_session.scalar(select(func.count()).select_from(ProviderCredential)) == 1
    assert len(case.cache_deletes) == len(case.cache_sources) == 2
    assert set(case.cache_sources[0][1]) == {
        ProviderConfigurationCacheSource.PREFERRED_MODEL_PROVIDERS,
        ProviderConfigurationCacheSource.PROVIDER_CREDENTIALS,
    }


def test_cache_failure_after_real_commit_retries_without_billing_or_a_second_credential(
    activation_case: ActivationCase,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = activation_case
    calls: list[str] = []

    def fail_once(cache: ProviderCredentialsCache) -> None:
        calls.append(cache.cache_key)
        if len(calls) == 1:
            raise RuntimeError("unit cache outage")

    monkeypatch.setattr(ProviderCredentialsCache, "delete", fail_once)
    snapshot = worker._IntegrationSnapshot(
        case.tenant_id, "Native", TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER, None, None
    )
    with pytest.raises(worker._BootstrapStepError, match="tokener_provider_credential_activation_failed"):
        worker._ensure_managed_credential(snapshot)
    assert worker._find_managed_credential(case.tenant_id) == (case.credential_id, True)
    assert worker._ensure_managed_credential(snapshot) == case.credential_id
    sqlite_session.expire_all()
    assert sqlite_session.scalar(select(func.count()).select_from(Provider)) == 1
    assert sqlite_session.scalar(select(func.count()).select_from(ProviderCredential)) == 1
    assert len(calls) == 2
    assert len(case.cache_sources) == 1


def test_real_native_owner_does_not_replace_selected_byok(
    activation_case: ActivationCase,
    sqlite_session: Session,
) -> None:
    case = activation_case
    byok = ProviderCredential(
        tenant_id=case.tenant_id,
        provider_name=PROVIDER,
        credential_name="user BYOK",
        encrypted_config="UNCHANGED_USER_CIPHERTEXT",
    )
    sqlite_session.add(byok)
    sqlite_session.flush()
    row = Provider(
        tenant_id=case.tenant_id,
        provider_name=PROVIDER,
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
        credential_id=byok.id,
    )
    sqlite_session.add(row)
    sqlite_session.commit()
    with pytest.raises(worker._BootstrapStepError, match="tokener_provider_credential_activation_failed"):
        worker._activate_managed_credential(case.tenant_id, case.credential_id)
    sqlite_session.expire_all()
    assert row.credential_id == byok.id
    assert byok.encrypted_config == "UNCHANGED_USER_CIPHERTEXT"
    assert case.cache_deletes == []
    assert case.cache_sources == []


def test_real_activation_rejects_cross_tenant_and_unbound_credentials(
    activation_case: ActivationCase,
    sqlite_session: Session,
) -> None:
    case = activation_case
    other = Tenant(name="Other owner")
    sqlite_session.add(other)
    sqlite_session.flush()
    credential = ProviderCredential(
        tenant_id=other.id, provider_name=PROVIDER, credential_name="other", encrypted_config="OTHER_UNCHANGED"
    )
    sqlite_session.add(credential)
    sqlite_session.commit()
    with pytest.raises(ValueError, match="Credential record not found"):
        case.configuration.activate_unselected_provider_credential(credential.id)
    with pytest.raises(worker._BootstrapStepError, match="tokener_provider_credential_activation_failed"):
        worker._activate_managed_credential(case.tenant_id, credential.id)
    assert sqlite_session.scalar(select(func.count()).select_from(Provider)) == 0
    assert credential.encrypted_config == "OTHER_UNCHANGED"
