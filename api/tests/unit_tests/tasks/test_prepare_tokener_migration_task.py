import json
from datetime import timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from models.provider import Provider, ProviderCredential, ProviderType
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.entities.model_billing_migration import PrepareMigrationPayload, canonical_hash
from services.model_billing_migration_service import ModelBillingMigrationService
from tasks import prepare_tokener_migration_task as module


def add_migration_records(session: Session, tenant_id: str) -> str:
    migration_id = str(uuid4())
    session.add(TenantModelBillingMigration(tenant_id=tenant_id, migration_id=migration_id, batch_id="credential-test"))
    session.add(TenantTokenerIntegration(tenant_id=tenant_id))
    session.commit()
    return migration_id


def test_persist_key_does_not_change_byok_provider_or_activate_new_provider(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
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
    assert persisted.credential_id == "byok-original"
    assert persisted.is_valid is True
    credential = sqlite_session.get(ProviderCredential, credential_id)
    assert "ENCRYPTED_TEST_KEY" in credential.encrypted_config
    service.switch_active_provider_credential.assert_not_called()
    service.update_default_model_of_model_type.assert_not_called()
    assert len(list(sqlite_session.scalars(select(ProviderCredential)))) == 1
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
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
):
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


def test_prepare_resource_exchange_never_calls_signup_grant(monkeypatch: pytest.MonkeyPatch):
    response = {
        "tenant_id": "tenant-fixture",
        "status": "ready",
        "external_ref": "tenant-fixture",
        "preparation_ref": "prepare-fixture",
        "data_plane_api_key": "TEST_ONLY",
    }
    client = MagicMock(return_value=response)
    monkeypatch.setattr(module.BillingService, "_send_request", client)
    monkeypatch.setattr(module, "_persist_key", MagicMock(return_value="credential-fixture"))
    from tests.unit_tests.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="https://billing.example.test")
    result = module._prepare_resources("tenant-fixture", {"phase": "resources", "migration_id": "migration-fixture"})
    assert result == "credential-fixture"
    assert client.call_args.args[1].endswith("/prepare-migration")
    assert "bootstrap" not in client.call_args.args[1]
    assert response == {}


def test_cross_tenant_resource_response_is_rejected(monkeypatch: pytest.MonkeyPatch):
    from tests.unit_tests.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, TOKENER_BILLING_API_URL="https://billing.example.test")
    monkeypatch.setattr(
        module.BillingService,
        "_send_request",
        MagicMock(
            return_value={
                "tenant_id": "tenant-fixture",
                "external_ref": "another-tenant",
                "status": "ready",
                "data_plane_api_key": "TEST_ONLY",
            }
        ),
    )
    persist = MagicMock()
    monkeypatch.setattr(module, "_persist_key", persist)
    assert module._prepare_resources("tenant-fixture", {"phase": "resources"}) is None
    persist.assert_not_called()


def test_key_validation_exception_cannot_escape_with_plaintext(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
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
):
    from core import model_invocation_routing
    from tests.unit_tests.config_override import apply_config_overrides

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
        return_value={
            "tenant_id": tenant.id,
            "status": "ready",
            "external_ref": tenant.id,
            "preparation_ref": "preparation-fixture",
            "data_plane_api_key": "TEST_ONLY",
        },
    )
    monkeypatch.setattr(
        module.BillingService,
        "_send_request",
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
            module._run_preparation(tenant.id, payload.migration_id)
        crash_bound_id = module._find_bound_credential(tenant.id)
        assert crash_bound_id is not None
        assert crash_bound_id != fake_credential.id
        monkeypatch.setattr(module, "_update_integration", update)
    module._run_preparation(tenant.id, payload.migration_id)
    status = ModelBillingMigrationService.status(tenant.id)
    assert status["phase"] == "prepared"
    assert status["preparation_binding_hash"].startswith("sha256:")
    assert sqlite_session.get(TenantModelBillingProfile, tenant.id) is None
    sqlite_session.expire_all()
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    managed = sqlite_session.get(ProviderCredential, integration.provider_credential_id)
    assert managed.credential_name.startswith(f"{module.MANAGED_TOKENER_CREDENTIAL_NAME}:{payload.migration_id}")
    if fake_credential is not None:
        assert managed.id != fake_credential.id
        assert fake_credential.encrypted_config == '{"api_key":"PRIVATE_BYOK_ORG"}'
        assert sqlite_session.get(Provider, byok.id).credential_id == fake_credential.id
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
def test_bound_credential_requires_tenant_provider_and_nonempty_ciphertext(sqlite_session: Session, invalid_scope: str):
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
    integration.provider_credential_id = credential.id
    sqlite_session.commit()
    assert module._find_bound_credential(tenant.id) is None


def test_fresh_platform_binding_rejects_ciphertext_edit_before_ready(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
):
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
    assert row.state["provisioned_binding"]["provider_credential_id"] == credential_id
    original = row.state["provisioned_binding"]["credential_fingerprint"]
    credential.encrypted_config = '{"api_key":"PRIVATE_ORG_EDIT"}'
    sqlite_session.commit()
    assert module._find_bound_credential(tenant.id) is None
    sqlite_session.expire_all()
    assert (
        sqlite_session.get(TenantModelBillingMigration, tenant.id).state["provisioned_binding"][
            "credential_fingerprint"
        ]
        == original
    )


def test_credential_and_trusted_binding_roll_back_together_before_commit(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    tenant = Tenant(name="Atomic credential publication")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    migration_id = add_migration_records(sqlite_session, tenant.id)
    service = MagicMock()
    service._get_provider_configuration.return_value.validate_provider_credentials.side_effect = (
        lambda *_args, **_kwargs: {
            "api_key": "PLATFORM_ENCRYPTED",
        }
    )
    monkeypatch.setattr(module, "ModelProviderService", lambda: service)
    original_flush = Session.flush

    def fail_after_credential_flush(session, *args, **kwargs):
        contains_credential = any(isinstance(item, ProviderCredential) for item in session.new)
        original_flush(session, *args, **kwargs)
        if contains_credential:
            raise RuntimeError("simulated interruption before binding commit")

    monkeypatch.setattr(Session, "flush", fail_after_credential_flush)
    assert module._persist_key(tenant.id, migration_id, "PLATFORM_TEST_KEY") is None
    monkeypatch.setattr(Session, "flush", original_flush)
    sqlite_session.expire_all()
    assert sqlite_session.scalar(select(ProviderCredential).where(ProviderCredential.tenant_id == tenant.id)) is None
    assert module._find_bound_credential(tenant.id) is None
    assert "provisioned_binding" not in sqlite_session.get(TenantModelBillingMigration, tenant.id).state
    credential_id = module._persist_key(tenant.id, migration_id, "PLATFORM_TEST_KEY")
    assert credential_id is not None
    assert module._find_bound_credential(tenant.id) == credential_id


def test_sweeper_alerts_and_recovers_financial_work_but_stops_initial_30_minute_retries(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
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
    dispatch = MagicMock()
    monkeypatch.setattr(module.resume_tokener_migration_task, "delay", dispatch)
    assert module.sweep_tokener_migrations_task.run() == 2
    sqlite_session.expire_all()
    assert rows[0].attention == "alerted"
    assert rows[1].attention == "manual_required"
    assert rows[2].attention == "normal"
    assert rows[1].claimed_at == now - timedelta(seconds=1801)
    assert dispatch.call_count == 2


def test_financial_recovery_calls_only_durable_resume_endpoint(monkeypatch: pytest.MonkeyPatch):
    from tests.unit_tests.config_override import apply_config_overrides

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
    client = MagicMock()
    monkeypatch.setattr(module.BillingService, "_send_request", client)
    module.resume_tokener_migration_task.run("tenant-fixture", migration_id)
    assert client.call_args.args[1].endswith("/resume-migration")
    assert client.call_args.kwargs["json"] == {"api_version": 1, "migration_id": migration_id}


def test_sweeper_recovers_unpublished_cancelled_routing_but_not_completed_or_overdue(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
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
    dispatch = MagicMock()
    monkeypatch.setattr(module.resume_tokener_migration_task, "delay", dispatch)
    assert module.sweep_tokener_migrations_task.run() == 1
    dispatch.assert_called_once_with(rows[0].tenant_id, rows[0].migration_id)
    sqlite_session.expire_all()
    assert rows[0].attention == "alerted"
    assert rows[1].attention == "manual_required"
