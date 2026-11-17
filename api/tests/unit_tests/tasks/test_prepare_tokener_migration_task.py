import json
from collections.abc import Sequence
from datetime import timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.entities.provider_configuration import ProviderConfiguration
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from models.provider import Provider, ProviderCredential, ProviderType
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.billing_client import billing
from services.entities.model_billing_migration import PrepareMigrationPayload, canonical_hash
from services.model_billing_migration_service import ModelBillingMigrationService
from tasks import prepare_tokener_migration_task as module


def resource_request(migration_id: str = "33333333-3333-4333-8333-333333333333") -> dict[str, object]:
    return billing.TokenerMigrationPreparePayload(
        api_version=1,
        operation_id="22222222-2222-4222-8222-222222222222",
        expected_revision=0,
        migration_id=migration_id,
        batch_id="resource-fixture",
        eligibility_policy_version="paid-legacy-v1",
        model_mapping_version="mapping-v1",
        inventory_hash="sha256:" + "1" * 64,
        phase="resources",
    ).model_dump(exclude_none=True)


class HistoricalReadinessQuery:
    def readiness(
        self, tenant_id: str, revision: str, *, eligibility_policy_version: str | None = None
    ) -> dict[str, object]:
        from core.model_invocation_routing import validate_migration_readiness

        return validate_migration_readiness(tenant_id, revision, eligibility_policy_version=eligibility_policy_version)


@pytest.mark.parametrize("pin_kind", ["valid", "missing", "wrong"])
@pytest.mark.parametrize(
    ("official_variants", "embedding_variants", "daemon_variants"),
    [(False, False, False), (True, False, False), (False, True, False), (False, False, True)],
)
def test_variant_readiness_pin_flows_internally_worker_sql_claim_and_narrow_runtime_projection(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    pin_kind: str,
    official_variants: bool,
    embedding_variants: bool,
    daemon_variants: bool,
) -> None:
    from core.repositories import model_billing_migration_repository
    from services.model_billing_mapping_service import source_mapping_revision
    from services.model_billing_migration_service import MigrationError
    from tests.helpers.unit.config_override import apply_config_overrides, config_overrides_context
    from tests.unit_tests.services.test_model_billing_source_variants import (
        OFFICIAL_ROOT_REVISION,
        REVISION,
        full_official_registry,
        variant_record,
    )

    revision = OFFICIAL_ROOT_REVISION if official_variants else REVISION
    records = full_official_registry() if official_variants else [variant_record()]
    if embedding_variants:
        from tests.helpers.unit.model_billing_source_profiles import EMBEDDING_REVISION, full_embedding_registry

        revision = EMBEDDING_REVISION
        records = full_embedding_registry()
    if daemon_variants:
        from tests.helpers.unit.model_billing_source_profiles import DAEMON_REVISION, full_daemon_registry

        revision = DAEMON_REVISION
        records = full_daemon_registry()
    tenant = Tenant(name="New source-variant internal preparation")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    raw = json.dumps(records)
    registry = source_mapping_revision(raw, revision)
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MIGRATION_ENABLED=True,
        TOKENER_LEGACY_MIGRATION_ALLOWLIST=tenant.id,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER="langgenius/tokener:0.1.3@fixture",
        TOKENER_LEGACY_MODEL_MAPPING_JSON=raw,
        TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=json.dumps(
            [{"schema_version": 1, "mapping_revision": revision, "inventory_policy": "saved_system_dependencies_v2"}]
        ),
    )
    monkeypatch.setattr(ModelBillingMigrationService, "enqueue_prepare", lambda *_args: None)
    inventory_hash = "sha256:" + "1" * 64
    payload = PrepareMigrationPayload(
        api_version=1,
        operation_id=str(uuid4()),
        expected_revision=0,
        migration_id=str(uuid4()),
        batch_id="variant-internal",
        eligibility_policy_version="paid-v1",
        model_mapping_version=revision,
        inventory_hash=inventory_hash,
        billing_preparation_ref="existing-internal-binding",
    )
    ModelBillingMigrationService.prepare(tenant.id, payload)
    credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name="langgenius/tokener/tokener",
        credential_name="managed-test",
        encrypted_config='{"api_key":"encrypted-test-only"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert integration is not None
    integration.status = TenantTokenerIntegrationStatus.READY
    integration.provider_credential_id = credential.id
    sqlite_session.commit()
    monkeypatch.setattr(module, "_begin_attempt", lambda _tenant: object())
    monkeypatch.setattr(module, "_ensure_plugin_installed", lambda _snapshot: None)
    monkeypatch.setattr(module, "_find_bound_credential", lambda _tenant: credential.id)
    monkeypatch.setattr(module, "_update_integration", lambda *_args, **_kwargs: None)

    class Readiness:
        def readiness(
            self, tenant_id: str, revision: str, *, eligibility_policy_version: str | None = None
        ) -> dict[str, object]:
            assert tenant_id == tenant.id
            assert revision == payload.model_mapping_version
            assert eligibility_policy_version == "paid-v1"
            result: dict[str, object] = {
                "inventory_hash": inventory_hash,
                "source_ownership": {},
                "credential_fingerprint": canonical_hash({"encrypted_config": credential.encrypted_config}),
            }
            if pin_kind != "missing":
                result["source_variant_registry_digest"] = (
                    registry.digest if pin_kind == "valid" else "sha256:" + "f" * 64
                )
            return result

    if pin_kind != "valid":
        with pytest.raises(MigrationError, match="readiness_changed"):
            module._run_preparation(tenant.id, payload.migration_id, readiness_query=Readiness())
        sqlite_session.expire_all()
        unchanged = sqlite_session.get(TenantModelBillingMigration, tenant.id)
        assert unchanged is not None
        assert unchanged.phase == "preparing"
        assert "source_variant_registry_digest" not in unchanged.state
        return
    module._run_preparation(tenant.id, payload.migration_id, readiness_query=Readiness())
    sqlite_session.expire_all()
    row = sqlite_session.get(TenantModelBillingMigration, tenant.id)
    assert row is not None
    assert row.phase == "prepared"
    assert row.state["source_variant_registry_digest"] == registry.digest
    assert row.state["preparation"]["source_variant_registry_digest"] == registry.digest
    assert "source_variant" not in row.state
    assert "source_variant" not in row.state["preparation"]
    monkeypatch.setattr(model_billing_migration_repository.session_factory, "create_session", sqlite_session_factory)
    projected = model_billing_migration_repository.get_routing_state(tenant.id)
    assert projected is not None
    assert projected["source_variant_registry_digest"] == registry.digest
    assert "manifest" not in projected
    ModelBillingMigrationService.assert_claim_readiness(
        sqlite_session, row, module.naive_utc_now(), row.state["preparation_binding_hash"]
    )
    changed = json.loads(raw)
    changed[0]["pool_types"] = ["paid"]
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps(changed)):
        with pytest.raises(MigrationError, match="readiness_changed"):
            ModelBillingMigrationService.assert_claim_readiness(
                sqlite_session, row, module.naive_utc_now(), row.state["preparation_binding_hash"]
            )


@pytest.mark.parametrize("policy", ["paid-legacy-v1", "free-legacy-v1", "unknown-policy"])
def test_prepare_worker_passes_only_persisted_eligibility_policy(
    mocker: MockerFixture, sqlite_session: Session, policy: str
) -> None:
    from core import model_invocation_routing

    tenant, row, credential = prepared_resource_records(sqlite_session, policy=policy)
    tenant_id, migration_id = tenant.id, row.migration_id
    mocker.patch.object(module, "_ensure_plugin_installed")
    fingerprint = canonical_hash({"encrypted_config": credential.encrypted_config})
    readiness = mocker.patch.object(
        model_invocation_routing,
        "validate_migration_readiness",
        return_value={
            "inventory_hash": canonical_hash([]),
            "source_ownership": {},
            "credential_fingerprint": fingerprint,
        },
    )
    complete = mocker.spy(ModelBillingMigrationService, "complete_preparation")
    module._run_preparation(tenant_id, migration_id, readiness_query=HistoricalReadinessQuery())
    readiness.assert_called_once_with(tenant_id, "mapping-v1", eligibility_policy_version=policy)
    complete.assert_called_once_with(
        tenant_id,
        migration_id,
        source_ownership={},
        expected_credential_fingerprint=fingerprint,
    )
    sqlite_session.expire_all()
    assert row.phase == "prepared"


def prepared_resource_records(
    session: Session, *, policy: str = "paid-legacy-v1"
) -> tuple[Tenant, TenantModelBillingMigration, ProviderCredential]:
    """Persist real resource bindings for normal worker and completion owners."""
    tenant = Tenant(name="Empty source fixture")
    session.add(tenant)
    session.flush()
    state = {
        "operations": {str(uuid4()): {"action": "prepare"}},
        "eligibility_policy_version": policy,
        "model_mapping_version": "mapping-v1",
        "inventory_hash": canonical_hash([]),
        "billing_preparation_ref": "existing-resource-fixture",
    }
    row = TenantModelBillingMigration(
        tenant_id=tenant.id, migration_id=str(uuid4()), batch_id="resource-fixture", phase="preparing", state=state
    )
    credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name="langgenius/tokener/tokener",
        credential_name="Managed resource fixture",
        encrypted_config='{"api_key":"ENCRYPTED_TEST_ONLY"}',
    )
    integration = TenantTokenerIntegration(
        tenant_id=tenant.id,
        status=TenantTokenerIntegrationStatus.READY,
        plugin_unique_identifier="langgenius/tokener:0.1.3@fixture",
        provider_credential_id=credential.id,
    )
    session.add_all([row, credential, integration])
    session.commit()
    return tenant, row, credential


@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("source_ownership", None),
        ("source_ownership", []),
        ("source_ownership", {1: {}}),
        ("credential_fingerprint", None),
        ("credential_fingerprint", 1),
        ("source_variant_registry_digest", None),
        ("source_variant_registry_digest", 1),
    ],
)
def test_malformed_readiness_cannot_complete_or_activate(
    mocker: MockerFixture, sqlite_session: Session, field: str, invalid: object
) -> None:
    from core import model_invocation_routing

    tenant, row, credential = prepared_resource_records(sqlite_session)
    state_before = dict(row.state)
    readiness: dict[str, object] = {
        "inventory_hash": canonical_hash([]),
        "source_ownership": {},
        "credential_fingerprint": canonical_hash({"encrypted_config": credential.encrypted_config}),
    }
    readiness[field] = invalid
    mocker.patch.object(module, "_ensure_plugin_installed")
    mocker.patch.object(model_invocation_routing, "validate_migration_readiness", return_value=readiness)
    complete = mocker.spy(ModelBillingMigrationService, "complete_preparation")
    with pytest.raises(module.PreparationStepError, match="^migration_readiness_invalid$"):
        module._run_preparation(tenant.id, row.migration_id, readiness_query=HistoricalReadinessQuery())
    complete.assert_not_called()
    sqlite_session.expire_all()
    assert row.phase == "preparing"
    assert row.state == state_before
    assert sqlite_session.get(TenantModelBillingProfile, tenant.id) is None


def add_migration_records(session: Session, tenant_id: str) -> str:
    migration_id = str(uuid4())
    session.add(TenantModelBillingMigration(tenant_id=tenant_id, migration_id=migration_id, batch_id="credential-test"))
    session.add(TenantTokenerIntegration(tenant_id=tenant_id))
    session.commit()
    return migration_id


def test_persist_key_does_not_change_byok_provider_or_activate_new_provider(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    tenant = Tenant(name="Preserve BYOK")
    sqlite_session.add(tenant)
    sqlite_session.flush()
    provider = Provider(
        tenant_id=tenant.id,
        provider_name="langgenius/tokener/tokener",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
        credential_id="byok-original",
    )
    sqlite_session.add(provider)
    sqlite_session.commit()
    migration_id = add_migration_records(sqlite_session, tenant.id)
    service = MagicMock()
    service._get_provider_configuration.return_value.validate_provider_credentials.return_value = {
        "api_key": "ENCRYPTED_TEST_KEY",
    }
    monkeypatch.setattr(module, "ModelProviderService", lambda: service)
    credential_id = module._persist_key(tenant.id, migration_id, "TEST_KEY_NOT_REAL")
    assert credential_id is not None
    assert module._persist_key(tenant.id, migration_id, "TEST_KEY_NOT_REAL") == credential_id
    sqlite_session.expire_all()
    persisted = sqlite_session.get(Provider, provider.id)
    assert persisted is not None
    assert persisted.credential_id == "byok-original"
    assert persisted.is_valid is True
    credential = sqlite_session.get(ProviderCredential, credential_id)
    assert credential is not None
    assert "ENCRYPTED_TEST_KEY" in credential.encrypted_config
    service.switch_active_provider_credential.assert_not_called()
    service.update_default_model_of_model_type.assert_not_called()
    assert len(list(sqlite_session.scalars(select(ProviderCredential)))) == 1
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert integration is not None
    assert integration.provider_credential_id == credential_id
    assert integration.status == TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER
    service._get_provider_configuration.assert_called_once()
    credential.credential_name = "renamed platform credential"
    sqlite_session.commit()
    assert module._find_bound_credential(tenant.id) == credential_id
    assert module._persist_key(tenant.id, migration_id, "UNUSED_DUPLICATE_KEY") == credential_id
    service._get_provider_configuration.assert_called_once()


def test_persist_key_only_creates_credential_record(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    tenant = Tenant(name="No active provider")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    migration_id = add_migration_records(sqlite_session, tenant.id)
    service = MagicMock()
    service._get_provider_configuration.return_value.validate_provider_credentials.return_value = {
        "api_key": "ENCRYPTED_TEST_KEY",
    }
    monkeypatch.setattr(module, "ModelProviderService", lambda: service)
    assert module._persist_key(tenant.id, migration_id, "TEST_KEY_NOT_REAL") is not None
    assert sqlite_session.scalar(select(Provider).where(Provider.tenant_id == tenant.id)) is None


def test_prepare_resource_exchange_never_calls_signup_grant(monkeypatch: pytest.MonkeyPatch) -> None:
    response = billing.TokenerMigrationPrepareResult(
        tenant_id="tenant-fixture",
        status="ready",
        external_ref="tenant-fixture",
        preparation_ref="prepare-fixture",
        data_plane_api_key="TEST_ONLY",
    )
    client = MagicMock(return_value=response)
    monkeypatch.setattr(module.BillingService, "prepare_tokener_migration", client)
    monkeypatch.setattr(module, "_persist_key", MagicMock(return_value="credential-fixture"))
    from tests.helpers.unit.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="https://billing.example.test")
    request = resource_request()
    result = module._prepare_resources("tenant-fixture", request)
    assert result == "credential-fixture"
    client.assert_called_once_with("tenant-fixture", billing.TokenerMigrationPreparePayload.model_validate(request))
    assert response.data_plane_api_key is None


def test_cross_tenant_resource_response_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.helpers.unit.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="https://billing.example.test")
    monkeypatch.setattr(
        module.BillingService,
        "prepare_tokener_migration",
        MagicMock(
            return_value=billing.TokenerMigrationPrepareResult(
                tenant_id="tenant-fixture",
                external_ref="another-tenant",
                status="ready",
                preparation_ref="prepare-fixture",
                data_plane_api_key="TEST_ONLY",
            )
        ),
    )
    persist = MagicMock()
    monkeypatch.setattr(module, "_persist_key", persist)
    assert module._prepare_resources("tenant-fixture", resource_request()) is None
    persist.assert_not_called()


def test_key_validation_exception_cannot_escape_with_plaintext(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    tenant = Tenant(name="Secret isolation")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    migration_id = add_migration_records(sqlite_session, tenant.id)
    service = MagicMock()
    service._get_provider_configuration.side_effect = RuntimeError("TEST_SECRET_MUST_NOT_ESCAPE")
    monkeypatch.setattr(module, "ModelProviderService", lambda: service)
    assert module._persist_key(tenant.id, migration_id, "TEST_SECRET_MUST_NOT_ESCAPE") is None
    service._get_provider_configuration.assert_called_once()


@pytest.mark.parametrize("spoof_label", ["none", "reserved", "migration", "reserved-crash"])
def test_real_prepare_worker_publishes_binding_without_trial_or_active_provider(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    spoof_label: str,
) -> None:
    from core import model_invocation_routing
    from tests.helpers.unit.config_override import apply_config_overrides

    tenant = Tenant(name="Prepare-only workflow")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    inventory_hash = "sha256:" + "1" * 64
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MIGRATION_ENABLED=True,
        TOKENER_LEGACY_MIGRATION_ALLOWLIST=tenant.id,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER="langgenius/tokener:0.1.3@fixture",
        TOKENER_BILLING_API_URL="https://billing.example.test",
    )
    monkeypatch.setattr(ModelBillingMigrationService, "enqueue_prepare", lambda *_args: None)
    payload = PrepareMigrationPayload(
        api_version=1,
        operation_id=str(uuid4()),
        expected_revision=0,
        migration_id=str(uuid4()),
        batch_id="batch-fixture",
        eligibility_policy_version="paid-v1",
        model_mapping_version="mapping-v1",
        inventory_hash=inventory_hash,
        billing_preparation_ref="preparation-fixture",
    )
    ModelBillingMigrationService.prepare(tenant.id, payload)
    fake_credential = None
    byok = None
    if spoof_label != "none":
        fake_credential = ProviderCredential(
            tenant_id=tenant.id,
            provider_name="langgenius/tokener/tokener",
            credential_name=(
                f"{module.MANAGED_TOKENER_CREDENTIAL_NAME}:{payload.migration_id}"
                if spoof_label == "migration"
                else module.MANAGED_TOKENER_CREDENTIAL_NAME
            ),
            encrypted_config='{"api_key":"PRIVATE_BYOK_ORG"}',
        )
        sqlite_session.add(fake_credential)
        sqlite_session.flush()
        byok = Provider(
            tenant_id=tenant.id,
            provider_name="langgenius/tokener/tokener",
            is_valid=True,
            credential_id=fake_credential.id,
        )
        sqlite_session.add(byok)
        sqlite_session.commit()
    install = MagicMock()
    monkeypatch.setattr(module, "_ensure_plugin_installed", install)
    provision = MagicMock(
        return_value=billing.TokenerMigrationPrepareResult(
            tenant_id=tenant.id,
            status="ready",
            external_ref=tenant.id,
            preparation_ref="preparation-fixture",
            data_plane_api_key="TEST_ONLY",
        ),
    )
    monkeypatch.setattr(
        module.BillingService,
        "prepare_tokener_migration",
        provision,
    )
    signup = MagicMock()
    monkeypatch.setattr(module.BillingService, "bootstrap_tokener_tenant", signup)
    provider_service = MagicMock()
    provider_service._get_provider_configuration.return_value.validate_provider_credentials.return_value = {
        "api_key": "ENCRYPTED_TEST_KEY",
    }
    monkeypatch.setattr(module, "ModelProviderService", lambda: provider_service)
    monkeypatch.setattr(
        model_invocation_routing,
        "validate_migration_readiness",
        MagicMock(
            return_value={
                "inventory_hash": inventory_hash,
                "credential_fingerprint": canonical_hash(
                    {"encrypted_config": json.dumps({"api_key": "ENCRYPTED_TEST_KEY"})}
                ),
                "source_ownership": {
                    "langgenius/openai/openai": {
                        "current_quota_type": "paid",
                        "quotas": {"paid": {"unmetered": False}},
                    },
                },
            }
        ),
    )
    crash_bound_id = None
    if spoof_label == "reserved-crash":
        update = module._update_integration
        monkeypatch.setattr(
            module, "_update_integration", MagicMock(side_effect=RuntimeError("crash after credential commit"))
        )
        with pytest.raises(RuntimeError, match="crash after credential commit"):
            module._run_preparation(tenant.id, payload.migration_id, readiness_query=HistoricalReadinessQuery())
        crash_bound_id = module._find_bound_credential(tenant.id)
        assert crash_bound_id is not None
        assert fake_credential is not None
        assert crash_bound_id != fake_credential.id
        monkeypatch.setattr(module, "_update_integration", update)
    module._run_preparation(tenant.id, payload.migration_id, readiness_query=HistoricalReadinessQuery())
    status = ModelBillingMigrationService.status(tenant.id)
    assert status["phase"] == "prepared"
    assert status["preparation_binding_hash"].startswith("sha256:")
    assert sqlite_session.get(TenantModelBillingProfile, tenant.id) is None
    sqlite_session.expire_all()
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert integration is not None
    managed = sqlite_session.get(ProviderCredential, integration.provider_credential_id)
    assert managed is not None
    assert managed.credential_name.startswith(f"{module.MANAGED_TOKENER_CREDENTIAL_NAME}:{payload.migration_id}")
    if fake_credential is not None:
        assert managed.id != fake_credential.id
        assert fake_credential.encrypted_config == '{"api_key":"PRIVATE_BYOK_ORG"}'
        assert byok is not None
        persisted_byok = sqlite_session.get(Provider, byok.id)
        assert persisted_byok is not None
        assert persisted_byok.credential_id == fake_credential.id
    else:
        assert sqlite_session.scalar(select(Provider).where(Provider.tenant_id == tenant.id)) is None
    if crash_bound_id is not None:
        assert managed.id == crash_bound_id
    assert len(
        list(sqlite_session.scalars(select(ProviderCredential).where(ProviderCredential.tenant_id == tenant.id)))
    ) == (1 if fake_credential is None else 2)
    provision.assert_called_once()
    assert install.call_count == (2 if spoof_label == "reserved-crash" else 1)
    signup.assert_not_called()
    provider_service.switch_active_provider_credential.assert_not_called()


@pytest.mark.parametrize("invalid_scope", ["tenant", "provider", "empty_ciphertext"])
def test_bound_credential_requires_tenant_provider_and_nonempty_ciphertext(
    sqlite_session: Session, invalid_scope: str
) -> None:
    tenant = Tenant(name="Trusted integration owner")
    other = Tenant(name="Other owner")
    sqlite_session.add_all([tenant, other])
    sqlite_session.commit()
    add_migration_records(sqlite_session, tenant.id)
    credential = ProviderCredential(
        tenant_id=other.id if invalid_scope == "tenant" else tenant.id,
        provider_name="langgenius/openai/openai" if invalid_scope == "provider" else "langgenius/tokener/tokener",
        credential_name=module.MANAGED_TOKENER_CREDENTIAL_NAME,
        encrypted_config="" if invalid_scope == "empty_ciphertext" else '{"api_key":"ENCRYPTED"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert integration is not None
    integration.provider_credential_id = credential.id
    sqlite_session.commit()
    assert module._find_bound_credential(tenant.id) is None


def test_fresh_platform_binding_rejects_ciphertext_edit_before_ready(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant = Tenant(name="Credential pin")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    migration_id = add_migration_records(sqlite_session, tenant.id)
    service = MagicMock()
    service._get_provider_configuration.return_value.validate_provider_credentials.return_value = {
        "api_key": "PLATFORM_ENCRYPTED"
    }
    monkeypatch.setattr(module, "ModelProviderService", lambda: service)
    credential_id = module._persist_key(tenant.id, migration_id, "PLATFORM_TEST_KEY")
    assert credential_id is not None
    sqlite_session.expire_all()
    row = sqlite_session.get(TenantModelBillingMigration, tenant.id)
    credential = sqlite_session.get(ProviderCredential, credential_id)
    assert row is not None
    assert credential is not None
    assert row.state["provisioned_binding"]["provider_credential_id"] == credential_id
    original = row.state["provisioned_binding"]["credential_fingerprint"]
    credential.encrypted_config = '{"api_key":"PRIVATE_ORG_EDIT"}'
    sqlite_session.commit()
    assert module._find_bound_credential(tenant.id) is None
    sqlite_session.expire_all()
    refreshed_migration = sqlite_session.get(TenantModelBillingMigration, tenant.id)
    assert refreshed_migration is not None
    assert refreshed_migration.state["provisioned_binding"]["credential_fingerprint"] == original


def test_credential_and_trusted_binding_roll_back_together_before_commit(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    mocker: MockerFixture,
) -> None:
    tenant = Tenant(name="Atomic credential publication")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    migration_id = add_migration_records(sqlite_session, tenant.id)
    configuration = ProviderConfiguration(
        tenant_id=tenant.id,
        provider=ProviderEntity(
            provider="langgenius/tokener/tokener",
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
    mocker.patch.object(module.ModelProviderService, "_get_provider_configuration", return_value=configuration)
    mocker.patch.object(
        ProviderConfiguration,
        "validate_provider_credentials",
        side_effect=lambda *_args: {"api_key": "PLATFORM_ENCRYPTED"},
    )
    original_flush = Session.flush

    def fail_after_credential_flush(session: Session, objects: Sequence[object] | None = None) -> None:
        contains_credential = any(isinstance(item, ProviderCredential) for item in session.new)
        original_flush(session, objects)
        if contains_credential:
            raise RuntimeError("simulated interruption before binding commit")

    monkeypatch.setattr(Session, "flush", fail_after_credential_flush)
    assert module._persist_key(tenant.id, migration_id, "PLATFORM_TEST_KEY") is None
    monkeypatch.setattr(Session, "flush", original_flush)
    sqlite_session.expire_all()
    assert sqlite_session.scalar(select(ProviderCredential).where(ProviderCredential.tenant_id == tenant.id)) is None
    assert module._find_bound_credential(tenant.id) is None
    migration = sqlite_session.get(TenantModelBillingMigration, tenant.id)
    assert migration is not None
    assert "provisioned_binding" not in migration.state
    credential_id = module._persist_key(tenant.id, migration_id, "PLATFORM_TEST_KEY")
    assert credential_id is not None
    assert module._find_bound_credential(tenant.id) == credential_id


def test_sweeper_alerts_and_recovers_financial_work_but_stops_initial_30_minute_retries(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    now = module.naive_utc_now()
    rows = []
    for age, activated in [(301, False), (1801, False), (86400, True)]:
        tenant = Tenant(name="Claim-age test")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        row = TenantModelBillingMigration(
            tenant_id=tenant.id,
            migration_id=str(uuid4()),
            batch_id="batch-clock",
            phase="blocked" if activated else "granting",
            claimed_at=now - timedelta(seconds=age),
            state={"ever_activated": activated},
        )
        sqlite_session.add(row)
        rows.append(row)
    sqlite_session.commit()
    monkeypatch.setattr(module, "naive_utc_now", lambda: now)
    dispatch = mocker.patch.object(module.resume_tokener_migration_task, "delay")
    assert module.sweep_tokener_migrations_task.run() == 2
    sqlite_session.expire_all()
    assert rows[0].attention == "alerted"
    assert rows[1].attention == "manual_required"
    assert rows[2].attention == "normal"
    assert rows[1].claimed_at == now - timedelta(seconds=1801)
    assert dispatch.call_count == 2


def test_financial_recovery_calls_only_durable_resume_endpoint(
    monkeypatch: pytest.MonkeyPatch, mocker: MockerFixture
) -> None:
    from tests.helpers.unit.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="https://billing.example.test")
    migration_id = str(uuid4())
    monkeypatch.setattr(
        ModelBillingMigrationService,
        "status",
        MagicMock(
            return_value={
                "migration_id": migration_id,
                "phase": "granting",
                "attention": "alerted",
            }
        ),
    )
    client = mocker.patch.object(module.BillingService, "resume_tokener_migration")
    module.resume_tokener_migration_task.run("tenant-fixture", migration_id)
    client.assert_called_once_with(
        "tenant-fixture", billing.TokenerMigrationResumePayload(api_version=1, migration_id=migration_id)
    )


def test_sweeper_recovers_unpublished_cancelled_routing_but_not_completed_or_overdue(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    now = module.naive_utc_now()
    rows = []
    for age, published in [(301, False), (1801, False), (301, True)]:
        tenant = Tenant(name="Terminal routing publication")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        row = TenantModelBillingMigration(
            tenant_id=tenant.id,
            migration_id=str(uuid4()),
            batch_id="terminal-publication",
            phase="cancelled",
            claimed_at=now - timedelta(seconds=age),
            state={"ever_activated": published},
        )
        sqlite_session.add(row)
        rows.append(row)
    sqlite_session.commit()
    monkeypatch.setattr(module, "naive_utc_now", lambda: now)
    dispatch = mocker.patch.object(module.resume_tokener_migration_task, "delay")
    assert module.sweep_tokener_migrations_task.run() == 1
    dispatch.assert_called_once_with(rows[0].tenant_id, rows[0].migration_id)
    sqlite_session.expire_all()
    assert rows[0].attention == "alerted"
    assert rows[1].attention == "manual_required"
