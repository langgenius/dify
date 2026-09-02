from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from celery.exceptions import Retry
from sqlalchemy import select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.account import Tenant
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from tasks import bootstrap_tokener_tenant_task as task_module
from tests.unit_tests.config_override import apply_config_overrides


def _persist_integration(
    session: Session,
    *,
    status: TenantTokenerIntegrationStatus = TenantTokenerIntegrationStatus.PENDING,
    install_task_id: str | None = None,
) -> TenantTokenerIntegration:
    tenant = Tenant(name="Tokener tenant")
    session.add(tenant)
    session.flush()
    integration = TenantTokenerIntegration(
        tenant_id=tenant.id,
        status=status,
        plugin_unique_identifier="langgenius/tokener:0.1.2@checksum",
        plugin_install_task_id=install_task_id,
    )
    session.add(integration)
    session.commit()
    return integration


def _snapshot(integration: TenantTokenerIntegration) -> task_module._IntegrationSnapshot:
    return task_module._IntegrationSnapshot(
        tenant_id=integration.tenant_id,
        tenant_name="Tokener tenant",
        status=integration.status,
        plugin_unique_identifier=integration.plugin_unique_identifier,
        plugin_install_task_id=integration.plugin_install_task_id,
    )


def test_task_uses_plugin_queue_and_late_acknowledgement() -> None:
    task = task_module.bootstrap_tokener_tenant_task

    assert task.queue == task_module.TOKENER_BOOTSTRAP_QUEUE
    assert task.acks_late is True
    assert task.reject_on_worker_lost is True


def test_task_persists_sanitized_retry_state_and_releases_lock(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    bootstrap_error = task_module._BootstrapStepError(
        "tokener_plugin_install_pending",
        retryable=True,
        stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
    )
    monkeypatch.setattr(task_module, "_run_bootstrap", MagicMock(side_effect=bootstrap_error))
    lock = MagicMock()
    lock.acquire.return_value = True
    monkeypatch.setattr(task_module.redis_client, "lock", MagicMock(return_value=lock))
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "retry", retry)

    with pytest.raises(Retry):
        task_module.bootstrap_tokener_tenant_task.run(integration.tenant_id)

    retry.assert_called_once_with(exc=bootstrap_error, countdown=task_module._RETRY_DELAY_SECONDS)
    lock.release.assert_called_once_with()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.status == TenantTokenerIntegrationStatus.INSTALLING_PLUGIN
    assert persisted.last_error_code == "tokener_plugin_install_pending"


def test_lock_backend_failure_is_sanitized_and_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    monkeypatch.setattr(
        task_module.redis_client,
        "lock",
        MagicMock(side_effect=ConnectionError("redis connection contained sensitive diagnostics")),
    )
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "retry", retry)

    with pytest.raises(Retry):
        task_module.bootstrap_tokener_tenant_task.run("tenant-1")

    retry.assert_called_once()
    retry_error = retry.call_args.kwargs["exc"]
    assert isinstance(retry_error, task_module._BootstrapStepError)
    assert retry_error.error_code == "tokener_bootstrap_lock_unavailable"
    assert "sensitive diagnostics" not in str(retry_error)


def test_run_bootstrap_marks_integration_ready(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    install = MagicMock()
    ensure_credential = MagicMock(return_value="credential-1")
    set_default = MagicMock()
    monkeypatch.setattr(task_module, "_ensure_plugin_installed", install)
    monkeypatch.setattr(task_module, "_ensure_managed_credential", ensure_credential)
    monkeypatch.setattr(task_module, "_set_default_llm", set_default)

    task_module._run_bootstrap(integration.tenant_id)

    sqlite_session.expire_all()
    persisted = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == integration.tenant_id)
    )
    assert persisted is not None
    assert persisted.status == TenantTokenerIntegrationStatus.READY
    assert persisted.provider_credential_id == "credential-1"
    assert persisted.ready_at is not None
    assert persisted.attempt_count == 1
    install.assert_called_once()
    ensure_credential.assert_called_once()
    set_default.assert_called_once_with(integration.tenant_id)


def test_run_bootstrap_is_noop_after_ready(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    integration = _persist_integration(sqlite_session, status=TenantTokenerIntegrationStatus.READY)
    install = MagicMock()
    monkeypatch.setattr(task_module, "_ensure_plugin_installed", install)

    task_module._run_bootstrap(integration.tenant_id)

    install.assert_not_called()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.attempt_count == 0


def test_package_install_persists_daemon_task_id_for_retry(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    apply_config_overrides(monkeypatch, TOKENER_PLUGIN_INSTALL_SOURCE="package")
    monkeypatch.setattr(task_module.PluginService, "list", MagicMock(return_value=[]))
    local_install = MagicMock(return_value=SimpleNamespace(all_installed=False, task_id="plugin-task-1"))
    marketplace_install = MagicMock()
    monkeypatch.setattr(task_module.PluginService, "install_from_local_pkg", local_install)
    monkeypatch.setattr(task_module.PluginService, "install_from_marketplace_pkg", marketplace_install)

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_plugin_installed(_snapshot(integration))

    assert exc_info.value.error_code == "tokener_plugin_install_pending"
    local_install.assert_called_once_with(integration.tenant_id, [integration.plugin_unique_identifier])
    marketplace_install.assert_not_called()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.plugin_install_task_id == "plugin-task-1"


def test_existing_managed_credential_skips_remote_bootstrap(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    find_credential = MagicMock(return_value=("credential-1", True))
    remote_bootstrap = MagicMock()
    monkeypatch.setattr(task_module, "_find_managed_credential", find_credential)
    monkeypatch.setattr(task_module.BillingService, "bootstrap_tokener_tenant", remote_bootstrap)

    credential_id = task_module._ensure_managed_credential(_snapshot(integration))

    assert credential_id == "credential-1"
    remote_bootstrap.assert_not_called()


def test_one_time_key_is_removed_from_response_after_credential_creation(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    response = {
        "tenant_id": integration.tenant_id,
        "status": "ready",
        "data_plane_api_key": "one-time-secret",
        "retryable": False,
    }
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=(None, False)))
    monkeypatch.setattr(
        task_module.BillingService,
        "bootstrap_tokener_tenant",
        MagicMock(return_value=response),
    )
    consume_key = MagicMock(return_value=task_module._CredentialWriteResult(credential_id="credential-1"))
    monkeypatch.setattr(task_module, "_consume_data_plane_api_key", consume_key)

    credential_id = task_module._ensure_managed_credential(_snapshot(integration))

    assert credential_id == "credential-1"
    consume_key.assert_called_once_with(integration.tenant_id, "one-time-secret")
    assert "data_plane_api_key" not in response


def test_consume_data_plane_api_key_includes_configured_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(
        monkeypatch,
        TOKENER_PROVIDER_NAME="langgenius/tokener/tokener",
        TOKENER_ENDPOINT_URL="https://api-staging.tokener.dev/v1",
    )
    provider_service = MagicMock()
    captured_credentials: list[dict[str, str]] = []
    provider_service.create_provider_credential.side_effect = lambda **kwargs: captured_credentials.append(
        dict(kwargs["credentials"])
    )
    monkeypatch.setattr(task_module, "ModelProviderService", MagicMock(return_value=provider_service))
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=("credential-1", True)))

    result = task_module._consume_data_plane_api_key("tenant-1", "one-time-secret")

    assert result == task_module._CredentialWriteResult(credential_id="credential-1")
    provider_service.create_provider_credential.assert_called_once()
    assert captured_credentials == [
        {
            "api_key": "one-time-secret",
            "endpoint_url": "https://api-staging.tokener.dev/v1",
        }
    ]


def test_credential_failure_traceback_frames_do_not_contain_one_time_key(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    one_time_key = "one-time-key-that-must-not-enter-sentry"
    response = {
        "tenant_id": integration.tenant_id,
        "status": "ready",
        "data_plane_api_key": one_time_key,
        "retryable": False,
    }
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=(None, False)))
    monkeypatch.setattr(task_module.BillingService, "bootstrap_tokener_tenant", MagicMock(return_value=response))
    provider_service = MagicMock()
    provider_service.create_provider_credential.side_effect = RuntimeError(f"provider rejected {one_time_key}")
    monkeypatch.setattr(task_module, "ModelProviderService", MagicMock(return_value=provider_service))

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_managed_credential(_snapshot(integration))

    assert exc_info.value.error_code == "tokener_provider_credential_rejected"
    assert one_time_key not in str(exc_info.value)
    assert "data_plane_api_key" not in response
    traceback_cursor = exc_info.value.__traceback__
    checked_production_frame = False
    while traceback_cursor is not None:
        frame = traceback_cursor.tb_frame
        if frame.f_code.co_filename.endswith("tasks/bootstrap_tokener_tenant_task.py"):
            checked_production_frame = True
            assert one_time_key not in repr(frame.f_locals)
        traceback_cursor = traceback_cursor.tb_next
    assert checked_production_frame is True


def test_recovery_sweeper_requeues_only_stale_incomplete_integrations(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    stale_pending = _persist_integration(sqlite_session)
    recent_pending = _persist_integration(sqlite_session)
    ready = _persist_integration(sqlite_session, status=TenantTokenerIntegrationStatus.READY)
    stale_at = naive_utc_now() - timedelta(minutes=10)
    stale_pending.updated_at = stale_at
    ready.updated_at = stale_at
    sqlite_session.commit()
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True,
        TOKENER_BOOTSTRAP_RECOVERY_TASK_INTERVAL=5,
        TOKENER_BOOTSTRAP_RECOVERY_BATCH_SIZE=100,
    )
    delay = MagicMock()
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "delay", delay)

    dispatched = task_module.sweep_pending_tokener_integrations_task.run()

    assert dispatched == 1
    delay.assert_called_once_with(stale_pending.tenant_id)
    assert recent_pending.tenant_id != stale_pending.tenant_id


def test_recovery_sweeper_retries_a_previous_broker_dispatch_failure(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    stale_pending = _persist_integration(sqlite_session)
    stale_pending.updated_at = naive_utc_now() - timedelta(minutes=10)
    sqlite_session.commit()
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True,
        TOKENER_BOOTSTRAP_RECOVERY_TASK_INTERVAL=5,
        TOKENER_BOOTSTRAP_RECOVERY_BATCH_SIZE=100,
    )
    delay = MagicMock(side_effect=ConnectionError("broker unavailable"))
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "delay", delay)

    assert task_module.sweep_pending_tokener_integrations_task.run() == 0
    delay.side_effect = None
    assert task_module.sweep_pending_tokener_integrations_task.run() == 1
    assert delay.call_count == 2
