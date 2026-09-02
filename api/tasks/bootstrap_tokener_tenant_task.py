"""Provision and configure the managed Tokener provider for a new tenant."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import cast

from celery import shared_task
from sqlalchemy import select

from configs import dify_config
from core.db.session_factory import session_factory
from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.plugin.plugin_service import PluginService
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.account import Tenant
from models.provider import Provider, ProviderCredential, ProviderType
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.billing_service import BillingService, TokenerBootstrapUpstreamError
from services.model_provider_service import ModelProviderService

logger = logging.getLogger(__name__)

TOKENER_BOOTSTRAP_QUEUE = "plugin"
MANAGED_TOKENER_CREDENTIAL_NAME = "__dify_managed_tokener_v1__"

_MAX_RETRIES = 60
_RETRY_DELAY_SECONDS = 5
_MAX_RETRY_DELAY_SECONDS = 60
_LOCK_TIMEOUT_SECONDS = 15 * 60
_UNSET = object()


@dataclass(frozen=True, slots=True)
class _IntegrationSnapshot:
    tenant_id: str
    tenant_name: str
    status: TenantTokenerIntegrationStatus
    plugin_unique_identifier: str | None
    plugin_install_task_id: str | None


@dataclass(frozen=True, slots=True)
class _CredentialWriteResult:
    """Secret-free result returned after consuming a one-time data-plane key."""

    credential_id: str | None = None
    error_code: str | None = None


class _BootstrapStepError(RuntimeError):
    """A secret-free task failure safe to persist and hand to Celery."""

    def __init__(
        self,
        error_code: str,
        *,
        retryable: bool,
        stage: TenantTokenerIntegrationStatus,
    ) -> None:
        super().__init__(error_code)
        self.error_code = error_code
        self.retryable = retryable
        self.stage = stage


def _begin_attempt(tenant_id: str) -> _IntegrationSnapshot | None:
    now = naive_utc_now()
    with session_factory.create_session() as session, session.begin():
        integration = session.scalar(
            select(TenantTokenerIntegration)
            .where(TenantTokenerIntegration.tenant_id == tenant_id)
            .with_for_update()
        )
        if integration is None:
            return None

        tenant = session.get(Tenant, tenant_id)
        if tenant is None:
            return None

        if integration.status != TenantTokenerIntegrationStatus.READY:
            integration.attempt_count += 1
            integration.last_attempt_at = now
            integration.last_error_code = None

        return _IntegrationSnapshot(
            tenant_id=tenant_id,
            tenant_name=tenant.name,
            status=integration.status,
            plugin_unique_identifier=integration.plugin_unique_identifier,
            plugin_install_task_id=integration.plugin_install_task_id,
        )


def _update_integration(
    tenant_id: str,
    *,
    status: TenantTokenerIntegrationStatus,
    plugin_install_task_id: str | None | object = _UNSET,
    provider_credential_id: str | None = None,
    error_code: str | None = None,
    ready: bool = False,
) -> None:
    with session_factory.create_session() as session, session.begin():
        integration = session.scalar(
            select(TenantTokenerIntegration)
            .where(TenantTokenerIntegration.tenant_id == tenant_id)
            .with_for_update()
        )
        if integration is None:
            return

        integration.status = status
        if plugin_install_task_id is not _UNSET:
            integration.plugin_install_task_id = cast(str | None, plugin_install_task_id)
        integration.last_error_code = error_code
        if provider_credential_id is not None:
            integration.provider_credential_id = provider_credential_id
        if ready:
            integration.ready_at = naive_utc_now()


def _installed_plugin_matches(tenant_id: str, plugin_unique_identifier: str) -> bool:
    plugin_id = plugin_unique_identifier.split(":", 1)[0]
    installed_plugins = PluginService.list(tenant_id)
    exact_match = any(
        plugin.plugin_id == plugin_id and plugin.plugin_unique_identifier == plugin_unique_identifier
        for plugin in installed_plugins
    )
    if exact_match:
        return True

    if any(plugin.plugin_id == plugin_id for plugin in installed_plugins):
        raise _BootstrapStepError(
            "tokener_plugin_version_conflict",
            retryable=False,
            stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
        )
    return False


def _ensure_plugin_installed(snapshot: _IntegrationSnapshot) -> None:
    plugin_unique_identifier = snapshot.plugin_unique_identifier
    if not plugin_unique_identifier:
        raise _BootstrapStepError(
            "tokener_plugin_not_configured",
            retryable=False,
            stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
        )

    _update_integration(
        snapshot.tenant_id,
        status=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
        plugin_install_task_id=snapshot.plugin_install_task_id,
    )
    if _installed_plugin_matches(snapshot.tenant_id, plugin_unique_identifier):
        _update_integration(
            snapshot.tenant_id,
            status=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
            plugin_install_task_id=None,
        )
        return

    if snapshot.plugin_install_task_id:
        install_task = PluginService.fetch_install_task(snapshot.tenant_id, snapshot.plugin_install_task_id)
        if install_task.status in {PluginInstallTaskStatus.Pending, PluginInstallTaskStatus.Running}:
            raise _BootstrapStepError(
                "tokener_plugin_install_pending",
                retryable=True,
                stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
            )
        if install_task.status == PluginInstallTaskStatus.Failed:
            _update_integration(
                snapshot.tenant_id,
                status=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
                plugin_install_task_id=None,
                error_code="tokener_plugin_install_failed",
            )
            raise _BootstrapStepError(
                "tokener_plugin_install_failed",
                retryable=True,
                stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
            )
        if _installed_plugin_matches(snapshot.tenant_id, plugin_unique_identifier):
            return

    if dify_config.TOKENER_PLUGIN_INSTALL_SOURCE == "package":
        response = PluginService.install_from_local_pkg(snapshot.tenant_id, [plugin_unique_identifier])
    else:
        response = PluginService.install_from_marketplace_pkg(snapshot.tenant_id, [plugin_unique_identifier])
    if response.all_installed:
        return
    if not response.task_id:
        raise _BootstrapStepError(
            "tokener_plugin_install_task_missing",
            retryable=True,
            stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
        )

    _update_integration(
        snapshot.tenant_id,
        status=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
        plugin_install_task_id=response.task_id,
    )
    raise _BootstrapStepError(
        "tokener_plugin_install_pending",
        retryable=True,
        stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
    )


def _find_managed_credential(tenant_id: str) -> tuple[str | None, bool]:
    provider_name = dify_config.TOKENER_PROVIDER_NAME
    with session_factory.create_session() as session:
        provider = session.scalar(
            select(Provider).where(
                Provider.tenant_id == tenant_id,
                Provider.provider_name == provider_name,
                Provider.provider_type == ProviderType.CUSTOM,
            )
        )
        credentials = list(
            session.scalars(
                select(ProviderCredential)
                .where(
                    ProviderCredential.tenant_id == tenant_id,
                    ProviderCredential.provider_name == provider_name,
                    ProviderCredential.credential_name == MANAGED_TOKENER_CREDENTIAL_NAME,
                )
                .order_by(ProviderCredential.created_at, ProviderCredential.id)
            )
        )

    if not credentials:
        return None, False
    if provider is not None:
        active = next((credential for credential in credentials if credential.id == provider.credential_id), None)
        if active is not None and provider.is_valid:
            return active.id, True
    return credentials[0].id, False


def _activate_managed_credential(tenant_id: str, credential_id: str) -> None:
    try:
        ModelProviderService().switch_active_provider_credential(
            tenant_id=tenant_id,
            provider=dify_config.TOKENER_PROVIDER_NAME,
            credential_id=credential_id,
        )
    except Exception:
        raise _BootstrapStepError(
            "tokener_provider_credential_activation_failed",
            retryable=True,
            stage=TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER,
        ) from None


def _consume_data_plane_api_key(tenant_id: str, data_plane_api_key: str) -> _CredentialWriteResult:
    """Consume a one-time key without allowing an exception to escape this frame.

    Any exception raised while validating or persisting the credential is converted
    to a secret-free value before this frame returns. The caller clears its own
    reference before raising the corresponding task error, keeping plaintext out
    of traceback locals and Sentry events.
    """
    credentials = {"api_key": data_plane_api_key}
    endpoint_url = dify_config.TOKENER_ENDPOINT_URL.strip()
    if endpoint_url:
        credentials["endpoint_url"] = endpoint_url
    try:
        ModelProviderService().create_provider_credential(
            tenant_id=tenant_id,
            provider=dify_config.TOKENER_PROVIDER_NAME,
            credentials=credentials,
            credential_name=MANAGED_TOKENER_CREDENTIAL_NAME,
        )
    except Exception:
        return _CredentialWriteResult(error_code="tokener_provider_credential_rejected")
    finally:
        credentials.clear()
        data_plane_api_key = ""

    try:
        credential_id, active = _find_managed_credential(tenant_id)
        if credential_id is None:
            return _CredentialWriteResult(error_code="tokener_provider_credential_not_persisted")
        if not active:
            _activate_managed_credential(tenant_id, credential_id)
        return _CredentialWriteResult(credential_id=credential_id)
    except _BootstrapStepError as error:
        return _CredentialWriteResult(error_code=error.error_code)
    except Exception:
        return _CredentialWriteResult(error_code="tokener_provider_credential_activation_failed")


def _ensure_managed_credential(snapshot: _IntegrationSnapshot) -> str:
    credential_id, active = _find_managed_credential(snapshot.tenant_id)
    if credential_id is not None:
        if not active:
            _activate_managed_credential(snapshot.tenant_id, credential_id)
        return credential_id

    _update_integration(
        snapshot.tenant_id,
        status=TenantTokenerIntegrationStatus.PROVISIONING,
        plugin_install_task_id=None,
    )
    try:
        response = BillingService.bootstrap_tokener_tenant(snapshot.tenant_id, snapshot.tenant_name)
    except TokenerBootstrapUpstreamError as error:
        raise _BootstrapStepError(
            error.error_code,
            retryable=error.retryable,
            stage=TenantTokenerIntegrationStatus.PROVISIONING,
        ) from None

    if response["status"] == "pending":
        raise _BootstrapStepError(
            response.get("error_code", "tokener_bootstrap_pending"),
            retryable=response["retryable"],
            stage=TenantTokenerIntegrationStatus.PROVISIONING,
        )

    data_plane_api_key = response.pop("data_plane_api_key", "")
    write_result = _consume_data_plane_api_key(snapshot.tenant_id, data_plane_api_key)
    data_plane_api_key = ""
    _update_integration(snapshot.tenant_id, status=TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER)
    if write_result.credential_id is not None:
        return write_result.credential_id
    raise _BootstrapStepError(
        write_result.error_code or "tokener_provider_credential_rejected",
        retryable=True,
        stage=TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER,
    )


def _set_default_llm(tenant_id: str) -> None:
    try:
        ModelProviderService().update_default_model_of_model_type(
            tenant_id=tenant_id,
            model_type="llm",
            provider=dify_config.TOKENER_PROVIDER_NAME,
            model=dify_config.TOKENER_DEFAULT_LLM_MODEL,
        )
    except Exception:
        raise _BootstrapStepError(
            "tokener_default_model_configuration_failed",
            retryable=True,
            stage=TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER,
        ) from None


def _run_bootstrap(tenant_id: str) -> None:
    snapshot = _begin_attempt(tenant_id)
    if snapshot is None or snapshot.status == TenantTokenerIntegrationStatus.READY:
        return

    _ensure_plugin_installed(snapshot)
    credential_id = _ensure_managed_credential(snapshot)
    _set_default_llm(snapshot.tenant_id)
    _update_integration(
        snapshot.tenant_id,
        status=TenantTokenerIntegrationStatus.READY,
        plugin_install_task_id=None,
        provider_credential_id=credential_id,
        ready=True,
    )


@shared_task(
    queue=TOKENER_BOOTSTRAP_QUEUE,
    bind=True,
    max_retries=_MAX_RETRIES,
    default_retry_delay=_RETRY_DELAY_SECONDS,
    acks_late=True,
    reject_on_worker_lost=True,
)
def bootstrap_tokener_tenant_task(self, tenant_id: str) -> None:
    """Drive the idempotent bootstrap while serializing work per tenant."""
    if not dify_config.TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED:
        return

    try:
        lock = redis_client.lock(
            f"tokener:new-tenant-bootstrap:{tenant_id}",
            timeout=_LOCK_TIMEOUT_SECONDS,
            blocking_timeout=0,
            thread_local=False,
        )
        acquired = lock.acquire(blocking=False)
    except Exception:
        lock_error = _BootstrapStepError(
            "tokener_bootstrap_lock_unavailable",
            retryable=True,
            stage=TenantTokenerIntegrationStatus.PENDING,
        )
        logger.warning("Tokener bootstrap lock is unavailable for tenant %s; scheduling retry", tenant_id)
        raise self.retry(exc=lock_error, countdown=_RETRY_DELAY_SECONDS) from None

    if not acquired:
        raise self.retry(
            exc=_BootstrapStepError(
                "tokener_bootstrap_locked",
                retryable=True,
                stage=TenantTokenerIntegrationStatus.PENDING,
            ),
            countdown=_RETRY_DELAY_SECONDS,
        )

    try:
        _run_bootstrap(tenant_id)
    except _BootstrapStepError as step_error:
        exhausted = self.request.retries >= _MAX_RETRIES
        _update_integration(
            tenant_id,
            status=TenantTokenerIntegrationStatus.FAILED if exhausted or not step_error.retryable else step_error.stage,
            error_code=step_error.error_code,
        )
        if step_error.retryable and not exhausted:
            countdown = min(_RETRY_DELAY_SECONDS * (2**self.request.retries), _MAX_RETRY_DELAY_SECONDS)
            logger.warning(
                "Tokener bootstrap will retry for tenant %s, error_code=%s, retry=%s/%s",
                tenant_id,
                step_error.error_code,
                self.request.retries + 1,
                _MAX_RETRIES,
            )
            raise self.retry(exc=step_error, countdown=countdown)

        # Deliberately omit exception serialization from this secret-adjacent task.
        logger.error(  # noqa: TRY400
            "Tokener bootstrap stopped for tenant %s, error_code=%s",
            tenant_id,
            step_error.error_code,
        )
        raise
    except Exception:
        sanitized_error = _BootstrapStepError(
            "tokener_bootstrap_internal_error",
            retryable=True,
            stage=TenantTokenerIntegrationStatus.FAILED,
        )
        exhausted = self.request.retries >= _MAX_RETRIES
        _update_integration(
            tenant_id,
            status=TenantTokenerIntegrationStatus.FAILED,
            error_code=sanitized_error.error_code,
        )
        if not exhausted:
            countdown = min(_RETRY_DELAY_SECONDS * (2**self.request.retries), _MAX_RETRY_DELAY_SECONDS)
            logger.warning(
                "Tokener bootstrap hit an internal error for tenant %s; scheduling retry %s/%s",
                tenant_id,
                self.request.retries + 1,
                _MAX_RETRIES,
            )
            raise self.retry(exc=sanitized_error, countdown=countdown) from None
        # Deliberately omit exception serialization from this secret-adjacent task.
        logger.error("Tokener bootstrap retry budget exhausted for tenant %s", tenant_id)  # noqa: TRY400
        raise sanitized_error from None
    finally:
        try:
            lock.release()
        except Exception:
            logger.warning("Tokener bootstrap lock expired before release for tenant %s", tenant_id)


@shared_task(queue=TOKENER_BOOTSTRAP_QUEUE)
def sweep_pending_tokener_integrations_task() -> int:
    """Recover bootstraps whose initial broker dispatch or retry chain was lost."""
    if not dify_config.TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED:
        return 0

    stale_before = naive_utc_now() - timedelta(
        minutes=dify_config.TOKENER_BOOTSTRAP_RECOVERY_TASK_INTERVAL,
    )
    recoverable_statuses = (
        TenantTokenerIntegrationStatus.PENDING,
        TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
        TenantTokenerIntegrationStatus.PROVISIONING,
        TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER,
    )
    with session_factory.create_session() as session:
        tenant_ids = list(
            session.scalars(
                select(TenantTokenerIntegration.tenant_id)
                .where(
                    TenantTokenerIntegration.status.in_(recoverable_statuses),
                    TenantTokenerIntegration.updated_at < stale_before,
                )
                .order_by(TenantTokenerIntegration.updated_at, TenantTokenerIntegration.id)
                .limit(dify_config.TOKENER_BOOTSTRAP_RECOVERY_BATCH_SIZE)
            )
        )

    dispatched = 0
    for tenant_id in tenant_ids:
        try:
            bootstrap_tokener_tenant_task.delay(tenant_id)
        except Exception:
            # Do not attach broker exception details; the next beat will retry.
            logger.error("Failed to recover Tokener bootstrap for tenant %s", tenant_id)  # noqa: TRY400
        else:
            dispatched += 1
    return dispatched
