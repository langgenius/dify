from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services import model_billing_profile_service as service_module
from services.model_billing_profile_service import (
    InvalidModelBillingProfileError,
    ModelBillingProfileCacheUnavailableError,
    ModelBillingProfileResolutionError,
    ModelBillingProfileService,
    ModelBillingSource,
)

_CACHE_KEY = "tenant:model-billing-source:v1:tenant-1"


def _tenant(session: Session) -> Tenant:
    tenant = Tenant(name="Billing profile tenant")
    session.add(tenant)
    session.flush()
    return tenant


def test_absent_profile_and_integration_resolve_to_legacy(sqlite_session: Session) -> None:
    tenant = _tenant(sqlite_session)
    sqlite_session.commit()

    resolution = ModelBillingProfileService.resolve(tenant.id, session=sqlite_session)

    assert resolution.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS
    assert resolution.tokener_bootstrap_status is None


def test_null_profile_source_resolves_to_legacy(sqlite_session: Session) -> None:
    tenant = _tenant(sqlite_session)
    sqlite_session.add(TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source=None))
    sqlite_session.commit()

    resolution = ModelBillingProfileService.resolve(tenant.id, session=sqlite_session)

    assert resolution.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS


def test_explicit_null_profile_remains_legacy_even_with_integration(sqlite_session: Session) -> None:
    tenant = _tenant(sqlite_session)
    sqlite_session.add_all(
        [
            TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source=None),
            TenantTokenerIntegration(
                tenant_id=tenant.id,
                status=TenantTokenerIntegrationStatus.READY,
            ),
        ]
    )
    sqlite_session.commit()

    resolution = ModelBillingProfileService.resolve(tenant.id, session=sqlite_session)

    assert resolution.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS
    assert resolution.tokener_bootstrap_status is None


@pytest.mark.parametrize(
    "status",
    [
        TenantTokenerIntegrationStatus.PENDING,
        TenantTokenerIntegrationStatus.READY,
        TenantTokenerIntegrationStatus.FAILED,
    ],
)
def test_tokener_profile_preserves_bootstrap_status(
    status: TenantTokenerIntegrationStatus,
    sqlite_session: Session,
) -> None:
    tenant = _tenant(sqlite_session)
    sqlite_session.add_all(
        [
            TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source="tokener"),
            TenantTokenerIntegration(tenant_id=tenant.id, status=status),
        ]
    )
    sqlite_session.commit()

    resolution = ModelBillingProfileService.resolve(tenant.id, session=sqlite_session)

    assert resolution.model_billing_source == ModelBillingSource.TOKENER
    assert resolution.tokener_bootstrap_status == status


def test_integration_without_profile_remains_legacy(sqlite_session: Session) -> None:
    tenant = _tenant(sqlite_session)
    sqlite_session.add(
        TenantTokenerIntegration(
            tenant_id=tenant.id,
            status=TenantTokenerIntegrationStatus.PROVISIONING,
        )
    )
    sqlite_session.commit()

    resolution = ModelBillingProfileService.resolve(tenant.id, session=sqlite_session)

    assert resolution.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS
    assert resolution.tokener_bootstrap_status is None


def test_legacy_cache_hit_avoids_all_profile_database_queries(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = MagicMock()
    cache.get.return_value = b"legacy_message_credits"
    session = MagicMock()
    monkeypatch.setattr(service_module, "redis_client", cache)

    resolution = ModelBillingProfileService.resolve("tenant-1", session=session)

    assert resolution.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS
    assert resolution.tokener_bootstrap_status is None
    cache.get.assert_called_once_with(_CACHE_KEY)
    session.scalar.assert_not_called()


def test_tokener_cache_hit_only_queries_integration_status(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = MagicMock()
    cache.get.return_value = "tokener"
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(status=TenantTokenerIntegrationStatus.READY)
    monkeypatch.setattr(service_module, "redis_client", cache)

    resolution = ModelBillingProfileService.resolve("tenant-1", session=session)

    assert resolution.model_billing_source == ModelBillingSource.TOKENER
    assert resolution.tokener_bootstrap_status == TenantTokenerIntegrationStatus.READY
    session.scalar.assert_called_once()
    cache.setex.assert_not_called()


def test_cache_miss_reads_profile_and_caches_normalized_source(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = MagicMock()
    cache.get.return_value = None
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(model_billing_source=None)
    monkeypatch.setattr(service_module, "redis_client", cache)

    resolution = ModelBillingProfileService.resolve("tenant-1", session=session)

    assert resolution.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS
    session.scalar.assert_called_once()
    cache.setex.assert_called_once_with(_CACHE_KEY, 600, "legacy_message_credits")


def test_redis_read_failure_falls_back_to_database(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = MagicMock()
    cache.get.side_effect = ConnectionError("redis unavailable")
    session = MagicMock()
    session.scalar.side_effect = [
        SimpleNamespace(model_billing_source="tokener"),
        SimpleNamespace(status=TenantTokenerIntegrationStatus.PENDING),
    ]
    monkeypatch.setattr(service_module, "redis_client", cache)

    resolution = ModelBillingProfileService.resolve("tenant-1", session=session)

    assert resolution.model_billing_source == ModelBillingSource.TOKENER
    assert resolution.tokener_bootstrap_status == TenantTokenerIntegrationStatus.PENDING
    assert session.scalar.call_count == 2


def test_unknown_cache_value_is_deleted_and_cannot_override_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache = MagicMock()
    cache.get.return_value = b"unknown"
    session = MagicMock()
    session.scalar.side_effect = [
        SimpleNamespace(model_billing_source="tokener"),
        SimpleNamespace(status=TenantTokenerIntegrationStatus.FAILED),
    ]
    monkeypatch.setattr(service_module, "redis_client", cache)

    resolution = ModelBillingProfileService.resolve("tenant-1", session=session)

    assert resolution.model_billing_source == ModelBillingSource.TOKENER
    assert resolution.tokener_bootstrap_status == TenantTokenerIntegrationStatus.FAILED
    cache.delete.assert_called_once_with(_CACHE_KEY)
    cache.setex.assert_called_once_with(_CACHE_KEY, 600, "tokener")


def test_unknown_profile_source_raises_typed_invalid_error() -> None:
    session = MagicMock()
    session.scalar.side_effect = [SimpleNamespace(model_billing_source="future_backend"), None]

    with pytest.raises(InvalidModelBillingProfileError):
        ModelBillingProfileService.resolve("tenant-1", session=session)


def test_database_error_raises_typed_unavailable_error() -> None:
    session = MagicMock()
    session.scalar.side_effect = RuntimeError("database unavailable")

    with pytest.raises(ModelBillingProfileResolutionError) as exc_info:
        ModelBillingProfileService.resolve("tenant-1", session=session)

    assert exc_info.value.error_code == "model_billing_profile_unavailable"


def test_invalidate_deletes_versioned_cache_key(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = MagicMock()
    monkeypatch.setattr(service_module, "redis_client", cache)

    ModelBillingProfileService.invalidate("tenant-1")

    cache.delete.assert_called_once_with(_CACHE_KEY)


def test_invalidate_raises_typed_error_when_redis_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    cache = MagicMock()
    cache.delete.side_effect = ConnectionError("redis unavailable")
    monkeypatch.setattr(service_module, "redis_client", cache)

    with pytest.raises(ModelBillingProfileCacheUnavailableError):
        ModelBillingProfileService.invalidate("tenant-1")
