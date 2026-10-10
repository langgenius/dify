"""Prepare migration resources without a trial grant, default-model or BYOK switch."""

import json
import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from services.model_provider.service import ModelProviderService
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.account import Tenant
from models.model_billing_migration import TenantModelBillingMigration
from models.provider import ProviderCredential
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.billing_service import BillingService
from services.entities.model_billing_migration import canonical_hash
from services.model_billing_migration_service import ModelBillingMigrationService
from tasks.bootstrap_tokener_tenant_task import (
    MANAGED_TOKENER_CREDENTIAL_NAME,
    _begin_attempt,
    _ensure_plugin_installed,
    _update_integration,
)

logger = logging.getLogger(__name__)


class PreparationStepError(RuntimeError):
    """Only a safe error code may cross this key-handling boundary."""


def _bound_credential_id(session: Session, tenant_id: str) -> str | None:
    """Only the platform integration reference is authority; labels are editable."""
    bound = session.execute(
        select(ProviderCredential.id, ProviderCredential.encrypted_config)
        .join(TenantTokenerIntegration, TenantTokenerIntegration.provider_credential_id == ProviderCredential.id)
        .where(
            TenantTokenerIntegration.tenant_id == tenant_id,
            ProviderCredential.tenant_id == tenant_id,
            ProviderCredential.provider_name == dify_config.TOKENER_PROVIDER_NAME,
            ProviderCredential.encrypted_config != "",
        )
    ).one_or_none()
    if bound is None:
        return None
    pin = session.scalar(
        select(TenantModelBillingMigration.state["provisioned_binding"]).where(
            TenantModelBillingMigration.tenant_id == tenant_id,
        )
    )
    if pin and (
        pin.get("provider_credential_id") != bound.id
        or pin.get("provider_name") != dify_config.TOKENER_PROVIDER_NAME
        or pin.get("tenant_id") != tenant_id
        or pin.get("credential_fingerprint") != canonical_hash({"encrypted_config": bound.encrypted_config})
    ):
        return None
    return bound.id


def _find_bound_credential(tenant_id: str) -> str | None:
    with session_factory.create_session() as session:
        return _bound_credential_id(session, tenant_id)


def _persist_key(tenant_id: str, migration_id: str, api_key: str) -> str | None:
    """Validate/encrypt, then atomically persist credential and trusted binding.

    The usual create_provider_credential method also changes provider preference;
    migration preparation intentionally must not invoke it. A duplicate delivery
    or crash after commit reuses the bound ID, never a user-controlled name.
    """
    credentials = {"api_key": api_key}
    if dify_config.TOKENER_ENDPOINT_URL.strip():
        credentials["endpoint_url"] = dify_config.TOKENER_ENDPOINT_URL.strip()
    encrypted: dict[str, Any] = {}
    try:
        with session_factory.create_session() as session:
            migration = session.get(TenantModelBillingMigration, tenant_id)
            if migration is None or migration.migration_id != migration_id:
                return None
            existing_id = _bound_credential_id(session, tenant_id)
            if existing_id is not None:
                return existing_id
            if migration.phase != "preparing":
                return None
        configuration = ModelProviderService()._get_provider_configuration(tenant_id, dify_config.TOKENER_PROVIDER_NAME)
        encrypted = configuration.validate_provider_credentials(credentials)
        with session_factory.create_session() as session, session.begin():
            # Serialize against duplicate workers; this is a short, local-only transaction.
            if session.scalar(select(Tenant).where(Tenant.id == tenant_id).with_for_update()) is None:
                return None
            migration = session.scalar(
                select(TenantModelBillingMigration)
                .where(
                    TenantModelBillingMigration.tenant_id == tenant_id,
                    TenantModelBillingMigration.migration_id == migration_id,
                )
                .with_for_update()
            )
            integration = session.scalar(
                select(TenantTokenerIntegration)
                .where(TenantTokenerIntegration.tenant_id == tenant_id)
                .with_for_update()
            )
            if migration is None or integration is None:
                return None
            existing_id = _bound_credential_id(session, tenant_id)
            if existing_id is not None:
                return existing_id
            if migration.phase != "preparing":
                return None
            base_name = f"{MANAGED_TOKENER_CREDENTIAL_NAME}:{migration_id}"
            names = set(
                session.scalars(
                    select(ProviderCredential.credential_name).where(
                        ProviderCredential.tenant_id == tenant_id,
                        ProviderCredential.provider_name == dify_config.TOKENER_PROVIDER_NAME,
                        ProviderCredential.credential_name.startswith(base_name, autoescape=True),
                    )
                )
            )
            credential_name = base_name
            suffix = 0
            while credential_name in names:
                suffix += 1
                credential_name = f"{base_name}:{suffix}"
            credential = ProviderCredential(
                tenant_id=tenant_id,
                provider_name=dify_config.TOKENER_PROVIDER_NAME,
                credential_name=credential_name,
                encrypted_config=json.dumps(encrypted),
            )
            session.add(credential)
            session.flush()
            integration.provider_credential_id = credential.id
            integration.status = TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER
            migration.state = {
                **migration.state,
                "provisioned_binding": {
                    "tenant_id": tenant_id,
                    "migration_id": migration_id,
                    "provider_name": dify_config.TOKENER_PROVIDER_NAME,
                    "provider_credential_id": credential.id,
                    "credential_fingerprint": canonical_hash({"encrypted_config": credential.encrypted_config}),
                },
            }
            migration.revision += 1
            return credential.id
    except Exception:
        return None
    finally:
        credentials.clear()
        encrypted.clear()
        api_key = ""


def _prepare_resources(tenant_id: str, request: dict[str, Any]) -> str | None:
    """Consume a one-time key in-frame; never let upstream exceptions carry it."""
    response: dict[str, Any] = {}
    key = ""
    try:
        base_url = dify_config.TOKENER_BILLING_API_URL.strip().rstrip("/")
        if not base_url:
            return None
        raw = BillingService._send_request(
            "POST",
            f"/internal/v1/tokener/tenants/{tenant_id}/prepare-migration",
            json=request,
            base_url=base_url,
        )
        if not isinstance(raw, dict):
            return None
        response = raw
        key = response.pop("data_plane_api_key", "")
        if (
            response.get("tenant_id") != tenant_id
            or response.get("status") != "ready"
            or response.get("external_ref") != tenant_id
            or not isinstance(key, str)
            or not key
        ):
            return None
        migration_id = request.get("migration_id")
        if not isinstance(migration_id, str) or not migration_id:
            return None
        return _persist_key(tenant_id, migration_id, key)
    except Exception:
        return None
    finally:
        key = ""
        response.clear()


def _run_preparation(tenant_id: str, migration_id: str) -> None:
    with session_factory.create_session() as session:
        row = session.get(TenantModelBillingMigration, tenant_id)
        tenant = session.get(Tenant, tenant_id)
        if row is None or row.migration_id != migration_id or row.phase != "preparing" or tenant is None:
            return
        state = dict(row.state)
        display_name = tenant.name
        # Reuse the original operation identity, never derive it from retry time.
        operation_id = next(iter(state["operations"]))
    snapshot = _begin_attempt(tenant_id)
    if snapshot is None:
        raise PreparationStepError("migration_integration_missing")
    _ensure_plugin_installed(snapshot)
    credential_id = _find_bound_credential(tenant_id)
    if credential_id is None:
        request = {
            "api_version": 1,
            "expected_revision": 0,
            "operation_id": operation_id,
            "migration_id": migration_id,
            "batch_id": state["batch_id"],
            "eligibility_policy_version": state["eligibility_policy_version"],
            "model_mapping_version": state["model_mapping_version"],
            "inventory_hash": state["inventory_hash"],
            "billing_preparation_ref": state["billing_preparation_ref"],
            "display_name": display_name,
            "phase": "resources",
        }
        credential_id = _prepare_resources(tenant_id, request)
        if credential_id is None:
            raise PreparationStepError("migration_resources_pending")
    _update_integration(
        tenant_id,
        status=TenantTokenerIntegrationStatus.READY,
        provider_credential_id=credential_id,
        plugin_install_task_id=None,
        ready=True,
    )
    from core.model_invocation_routing import validate_migration_readiness

    readiness = validate_migration_readiness(tenant_id, state["model_mapping_version"])
    if readiness["inventory_hash"] != state["inventory_hash"]:
        raise PreparationStepError("migration_inventory_changed")
    ModelBillingMigrationService.complete_preparation(
        tenant_id,
        migration_id,
        source_ownership=readiness["source_ownership"],
        expected_credential_fingerprint=readiness["credential_fingerprint"],
    )


@shared_task(queue="plugin", bind=True, max_retries=60, acks_late=True, reject_on_worker_lost=True)
def prepare_tokener_migration_task(self, tenant_id: str, migration_id: str) -> None:
    """Resume a persisted preparation; disabling admission never loses recovery."""
    lock = redis_client.lock(f"tokener:migration-prepare:{tenant_id}", timeout=300, blocking_timeout=0)
    acquired = False
    try:
        acquired = lock.acquire(blocking=False)
        if not acquired:
            raise PreparationStepError("migration_prepare_locked")
        _run_preparation(tenant_id, migration_id)
    except Exception:
        ModelBillingMigrationService.preparation_error(tenant_id, migration_id, "migration_prepare_pending")
        logger.warning("Migration preparation pending tenant=%s migration=%s", tenant_id, migration_id)
        raise self.retry(exc=PreparationStepError("migration_prepare_pending"), countdown=30) from None
    finally:
        if acquired:
            try:
                lock.release()
            except Exception:
                logger.warning("Migration preparation lease expired tenant=%s", tenant_id)


@shared_task(queue="plugin")
def resume_tokener_migration_task(tenant_id: str, migration_id: str) -> None:
    """Ask Billing to replay a durable financial intent; never invent an amount."""
    status = ModelBillingMigrationService.status(tenant_id)
    if (
        status["migration_id"] != migration_id
        or status["phase"] not in {"claimed", "granting", "activating", "blocked", "cancelled"}
        or (status["phase"] == "cancelled" and status["ever_activated"])
        or status["attention"] == "manual_required"
    ):
        return
    try:
        base_url = dify_config.TOKENER_BILLING_API_URL.strip().rstrip("/")
        if not base_url:
            return
        BillingService._send_request(
            "POST",
            f"/internal/v1/tokener/tenants/{tenant_id}/resume-migration",
            json={"api_version": 1, "migration_id": migration_id},
            base_url=base_url,
        )
    except Exception:
        # Next minute retries the same durable intent; no retry-derived identities.
        logger.warning("Migration financial recovery pending tenant=%s migration=%s", tenant_id, migration_id)


@shared_task(queue="plugin")
def sweep_tokener_migrations_task() -> int:
    """Recover dropped prepare work and emit attention without resetting claimed_at."""
    now = naive_utc_now()
    pending: list[tuple[str, str]] = []
    financial: list[tuple[str, str]] = []
    with session_factory.create_session() as session, session.begin():
        rows = session.scalars(
            select(TenantModelBillingMigration)
            .where(
                (TenantModelBillingMigration.phase != "active")
                & (
                    (TenantModelBillingMigration.phase != "cancelled")
                    | TenantModelBillingMigration.state["ever_activated"].as_boolean().is_not(True)
                ),
                TenantModelBillingMigration.attention != "manual_required",
            )
            .order_by(TenantModelBillingMigration.updated_at)
            .limit(500)
            .with_for_update(skip_locked=True)
        )
        for row in rows:
            if row.phase == "preparing" and row.updated_at < now - timedelta(minutes=1):
                pending.append((row.tenant_id, row.migration_id))
            if row.claimed_at is None:
                continue
            age = (now - row.claimed_at).total_seconds()
            activated = row.state.get("ever_activated", False)
            attention = (
                "normal" if activated else "manual_required" if age > 1800 else "alerted" if age > 300 else "normal"
            )
            if attention != "manual_required" and (
                row.phase in {"claimed", "granting", "activating", "blocked"}
                or (row.phase == "cancelled" and not activated)
            ):
                financial.append((row.tenant_id, row.migration_id))
            if row.attention != attention:
                row.attention = attention
                logger.warning(
                    "Tokener migration attention=%s tenant=%s migration=%s batch=%s age_seconds=%s",
                    attention,
                    row.tenant_id,
                    row.migration_id,
                    row.batch_id,
                    int(age),
                )
    for tenant_id, migration_id in pending:
        ModelBillingMigrationService.enqueue_prepare(tenant_id, migration_id)
    for tenant_id, migration_id in financial:
        try:
            resume_tokener_migration_task.delay(tenant_id, migration_id)
        except Exception:
            logger.warning("Migration financial recovery enqueue failed tenant=%s", tenant_id)
    return len(pending) + len(financial)
