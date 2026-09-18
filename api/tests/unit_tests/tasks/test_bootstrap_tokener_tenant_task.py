from datetime import timedelta
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import MagicMock

import pytest
from celery.exceptions import Retry
from sqlalchemy import select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from tasks import bootstrap_tokener_tenant_task as task_module
from tests.unit_tests.config_override import apply_config_overrides


class _CeleryTaskOptions(Protocol):
    queue: str
    acks_late: bool
    reject_on_worker_lost: bool


def _persist_integration(
    session: Session,
    *,
    status: TenantTokenerIntegrationStatus = TenantTokenerIntegrationStatus.PENDING,
    install_task_id: str | None = None,
    create_profile: bool = True,
    profile_source: str | None = "tokener",
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
    if create_profile:
        session.add(
            TenantModelBillingProfile(
                tenant_id=tenant.id,
                model_billing_source=profile_source,
            )
        )
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
    task = cast(_CeleryTaskOptions, task_module.bootstrap_tokener_tenant_task)

    assert task.queue == task_module.TOKENER_BOOTSTRAP_QUEUE
    assert task.acks_late is True
    assert task.reject_on_worker_lost is True


def test_attempt_and_update_ignore_missing_integration() -> None:
    assert task_module._begin_attempt("00000000-0000-0000-0000-000000000001") is None

    task_module._update_integration(
        "00000000-0000-0000-0000-000000000001",
        status=TenantTokenerIntegrationStatus.FAILED,
    )


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


@pytest.mark.parametrize(
    ("create_profile", "profile_source"),
    [
        (False, None),
        (True, None),
    ],
)
def test_legacy_profile_authority_blocks_all_bootstrap_side_effects(
    create_profile: bool,
    profile_source: str | None,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(
        sqlite_session,
        create_profile=create_profile,
        profile_source=profile_source,
    )
    install = MagicMock()
    ensure_credential = MagicMock()
    set_default = MagicMock()
    monkeypatch.setattr(task_module, "_ensure_plugin_installed", install)
    monkeypatch.setattr(task_module, "_ensure_managed_credential", ensure_credential)
    monkeypatch.setattr(task_module, "_set_default_llm", set_default)

    task_module._run_bootstrap(integration.tenant_id)

    install.assert_not_called()
    ensure_credential.assert_not_called()
    set_default.assert_not_called()
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


def test_plugin_install_requires_a_configured_identifier() -> None:
    snapshot = task_module._IntegrationSnapshot(
        tenant_id="tenant-1",
        tenant_name="Tokener tenant",
        status=TenantTokenerIntegrationStatus.PENDING,
        plugin_unique_identifier=None,
        plugin_install_task_id=None,
    )

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_plugin_installed(snapshot)

    assert exc_info.value.error_code == "tokener_plugin_not_configured"
    assert exc_info.value.retryable is False
    assert exc_info.value.stage == TenantTokenerIntegrationStatus.INSTALLING_PLUGIN


def test_exact_plugin_match_clears_stale_install_task(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session, install_task_id="stale-task")
    installed_plugin = SimpleNamespace(
        plugin_id="langgenius/tokener",
        plugin_unique_identifier=integration.plugin_unique_identifier,
    )
    monkeypatch.setattr(task_module.PluginService, "list", MagicMock(return_value=[installed_plugin]))

    task_module._ensure_plugin_installed(_snapshot(integration))

    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.plugin_install_task_id is None
    assert persisted.status == TenantTokenerIntegrationStatus.INSTALLING_PLUGIN


def test_installed_plugin_version_conflict_is_not_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    installed_plugin = SimpleNamespace(
        plugin_id="langgenius/tokener",
        plugin_unique_identifier="langgenius/tokener:older@checksum",
    )
    monkeypatch.setattr(task_module.PluginService, "list", MagicMock(return_value=[installed_plugin]))

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._installed_plugin_matches("tenant-1", "langgenius/tokener:0.1.2@checksum")

    assert exc_info.value.error_code == "tokener_plugin_version_conflict"
    assert exc_info.value.retryable is False


@pytest.mark.parametrize(
    "install_status",
    [task_module.PluginInstallTaskStatus.Pending, task_module.PluginInstallTaskStatus.Running],
)
def test_existing_plugin_install_task_waits_while_in_progress(
    install_status: task_module.PluginInstallTaskStatus,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session, install_task_id="plugin-task-1")
    monkeypatch.setattr(task_module.PluginService, "list", MagicMock(return_value=[]))
    fetch_task = MagicMock(return_value=SimpleNamespace(status=install_status))
    monkeypatch.setattr(task_module.PluginService, "fetch_install_task", fetch_task)

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_plugin_installed(_snapshot(integration))

    assert exc_info.value.error_code == "tokener_plugin_install_pending"
    assert exc_info.value.retryable is True
    fetch_task.assert_called_once_with(integration.tenant_id, "plugin-task-1")


def test_failed_plugin_install_task_is_cleared_before_retry(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session, install_task_id="plugin-task-1")
    monkeypatch.setattr(task_module.PluginService, "list", MagicMock(return_value=[]))
    monkeypatch.setattr(
        task_module.PluginService,
        "fetch_install_task",
        MagicMock(return_value=SimpleNamespace(status=task_module.PluginInstallTaskStatus.Failed)),
    )

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_plugin_installed(_snapshot(integration))

    assert exc_info.value.error_code == "tokener_plugin_install_failed"
    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.plugin_install_task_id is None
    assert persisted.last_error_code == "tokener_plugin_install_failed"


def test_successful_plugin_install_task_rechecks_installed_plugin(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session, install_task_id="plugin-task-1")
    installed_plugin = SimpleNamespace(
        plugin_id="langgenius/tokener",
        plugin_unique_identifier=integration.plugin_unique_identifier,
    )
    list_plugins = MagicMock(side_effect=[[], [installed_plugin]])
    monkeypatch.setattr(task_module.PluginService, "list", list_plugins)
    monkeypatch.setattr(
        task_module.PluginService,
        "fetch_install_task",
        MagicMock(return_value=SimpleNamespace(status=task_module.PluginInstallTaskStatus.Success)),
    )
    install_from_package = MagicMock()
    monkeypatch.setattr(task_module.PluginService, "install_from_local_pkg", install_from_package)

    task_module._ensure_plugin_installed(_snapshot(integration))

    assert list_plugins.call_count == 2
    install_from_package.assert_not_called()


def test_successful_plugin_task_without_installed_plugin_starts_fresh_install(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session, install_task_id="plugin-task-1")
    apply_config_overrides(monkeypatch, TOKENER_PLUGIN_INSTALL_SOURCE="package")
    monkeypatch.setattr(task_module.PluginService, "list", MagicMock(side_effect=[[], []]))
    monkeypatch.setattr(
        task_module.PluginService,
        "fetch_install_task",
        MagicMock(return_value=SimpleNamespace(status=task_module.PluginInstallTaskStatus.Success)),
    )
    install_from_package = MagicMock(return_value=SimpleNamespace(all_installed=True, task_id=None))
    monkeypatch.setattr(task_module.PluginService, "install_from_local_pkg", install_from_package)

    task_module._ensure_plugin_installed(_snapshot(integration))

    install_from_package.assert_called_once_with(integration.tenant_id, [integration.plugin_unique_identifier])


@pytest.mark.parametrize(
    ("all_installed", "expected_error"),
    [
        (True, None),
        (False, "tokener_plugin_install_task_missing"),
    ],
)
def test_marketplace_plugin_install_handles_terminal_response_without_task_id(
    all_installed: bool,
    expected_error: str | None,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    apply_config_overrides(monkeypatch, TOKENER_PLUGIN_INSTALL_SOURCE="marketplace")
    monkeypatch.setattr(task_module.PluginService, "list", MagicMock(return_value=[]))
    marketplace_install = MagicMock(return_value=SimpleNamespace(all_installed=all_installed, task_id=None))
    monkeypatch.setattr(task_module.PluginService, "install_from_marketplace_pkg", marketplace_install)

    if expected_error is None:
        task_module._ensure_plugin_installed(_snapshot(integration))
    else:
        with pytest.raises(task_module._BootstrapStepError) as exc_info:
            task_module._ensure_plugin_installed(_snapshot(integration))
        assert exc_info.value.error_code == expected_error

    marketplace_install.assert_called_once_with(integration.tenant_id, [integration.plugin_unique_identifier])


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


def test_find_managed_credential_returns_none_when_no_managed_credentials(
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)

    assert task_module._find_managed_credential(integration.tenant_id) == (None, False)


def test_find_managed_credential_recognizes_valid_active_provider(
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    credential = task_module.ProviderCredential(
        tenant_id=integration.tenant_id,
        provider_name=task_module.dify_config.TOKENER_PROVIDER_NAME,
        credential_name=task_module.MANAGED_TOKENER_CREDENTIAL_NAME,
        encrypted_config="encrypted-secret",
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    sqlite_session.add(
        task_module.Provider(
            tenant_id=integration.tenant_id,
            provider_name=task_module.dify_config.TOKENER_PROVIDER_NAME,
            provider_type=task_module.ProviderType.CUSTOM,
            is_valid=True,
            credential_id=credential.id,
        )
    )
    sqlite_session.commit()

    assert task_module._find_managed_credential(integration.tenant_id) == (credential.id, True)


def test_find_managed_credential_is_inactive_without_provider_row(sqlite_session: Session) -> None:
    integration = _persist_integration(sqlite_session)
    credential = task_module.ProviderCredential(
        tenant_id=integration.tenant_id,
        provider_name=task_module.dify_config.TOKENER_PROVIDER_NAME,
        credential_name=task_module.MANAGED_TOKENER_CREDENTIAL_NAME,
        encrypted_config="encrypted-secret",
    )
    sqlite_session.add(credential)
    sqlite_session.commit()

    assert task_module._find_managed_credential(integration.tenant_id) == (credential.id, False)


def test_find_managed_credential_returns_first_credential_when_provider_is_inactive(
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    credential = task_module.ProviderCredential(
        tenant_id=integration.tenant_id,
        provider_name=task_module.dify_config.TOKENER_PROVIDER_NAME,
        credential_name=task_module.MANAGED_TOKENER_CREDENTIAL_NAME,
        encrypted_config="encrypted-secret",
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    sqlite_session.add(
        task_module.Provider(
            tenant_id=integration.tenant_id,
            provider_name=task_module.dify_config.TOKENER_PROVIDER_NAME,
            provider_type=task_module.ProviderType.CUSTOM,
            is_valid=False,
            credential_id=credential.id,
        )
    )
    sqlite_session.commit()

    assert task_module._find_managed_credential(integration.tenant_id) == (credential.id, False)


def test_existing_inactive_managed_credential_is_activated(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=("credential-1", False)))
    activate = MagicMock()
    monkeypatch.setattr(task_module, "_activate_managed_credential", activate)
    remote_bootstrap = MagicMock()
    monkeypatch.setattr(task_module.BillingService, "bootstrap_tokener_tenant", remote_bootstrap)

    assert task_module._ensure_managed_credential(_snapshot(integration)) == "credential-1"
    activate.assert_called_once_with(integration.tenant_id, "credential-1")
    remote_bootstrap.assert_not_called()


def test_bootstrap_upstream_error_preserves_sanitized_retry_contract(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=(None, False)))
    upstream_error = task_module.TokenerBootstrapUpstreamError("tokener_bootstrap_unavailable", retryable=True)
    monkeypatch.setattr(
        task_module.BillingService,
        "bootstrap_tokener_tenant",
        MagicMock(side_effect=upstream_error),
    )

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_managed_credential(_snapshot(integration))

    assert exc_info.value.error_code == "tokener_bootstrap_unavailable"
    assert exc_info.value.retryable is True
    assert exc_info.value.stage == TenantTokenerIntegrationStatus.PROVISIONING


def test_pending_bootstrap_response_preserves_upstream_retry_policy(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=(None, False)))
    monkeypatch.setattr(
        task_module.BillingService,
        "bootstrap_tokener_tenant",
        MagicMock(return_value={"status": "pending", "retryable": False, "error_code": "trial_not_available"}),
    )

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_managed_credential(_snapshot(integration))

    assert exc_info.value.error_code == "trial_not_available"
    assert exc_info.value.retryable is False
    assert exc_info.value.stage == TenantTokenerIntegrationStatus.PROVISIONING


def test_credential_write_failure_is_raised_after_secret_is_consumed(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    response = {"status": "ready", "retryable": False, "data_plane_api_key": "one-time-secret"}
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=(None, False)))
    monkeypatch.setattr(task_module.BillingService, "bootstrap_tokener_tenant", MagicMock(return_value=response))
    monkeypatch.setattr(
        task_module,
        "_consume_data_plane_api_key",
        MagicMock(return_value=task_module._CredentialWriteResult(error_code="credential_write_failed")),
    )

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._ensure_managed_credential(_snapshot(integration))

    assert exc_info.value.error_code == "credential_write_failed"
    assert exc_info.value.retryable is True
    assert exc_info.value.stage == TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER
    assert "data_plane_api_key" not in response
    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.status == TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER


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


def test_consume_data_plane_api_key_reports_missing_persisted_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_service = MagicMock()
    monkeypatch.setattr(task_module, "ModelProviderService", MagicMock(return_value=provider_service))
    monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=(None, False)))

    result = task_module._consume_data_plane_api_key("tenant-1", "one-time-secret")

    assert result.error_code == "tokener_provider_credential_not_persisted"
    assert result.credential_id is None


@pytest.mark.parametrize(
    ("failure", "expected_error"),
    [
        (
            task_module._BootstrapStepError(
                "tokener_provider_credential_activation_failed",
                retryable=True,
                stage=TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER,
            ),
            "tokener_provider_credential_activation_failed",
        ),
        (RuntimeError("database details must not escape"), "tokener_provider_credential_activation_failed"),
    ],
)
def test_consume_data_plane_api_key_sanitizes_credential_lookup_or_activation_failure(
    failure: Exception,
    expected_error: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_service = MagicMock()
    monkeypatch.setattr(task_module, "ModelProviderService", MagicMock(return_value=provider_service))
    if isinstance(failure, task_module._BootstrapStepError):
        monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(return_value=("credential-1", False)))
        monkeypatch.setattr(task_module, "_activate_managed_credential", MagicMock(side_effect=failure))
    else:
        monkeypatch.setattr(task_module, "_find_managed_credential", MagicMock(side_effect=failure))

    result = task_module._consume_data_plane_api_key("tenant-1", "one-time-secret")

    assert result == task_module._CredentialWriteResult(error_code=expected_error)
    assert "database details" not in repr(result)


def test_activate_managed_credential_wraps_provider_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_service = MagicMock()
    provider_service.switch_active_provider_credential.side_effect = RuntimeError("provider secret")
    monkeypatch.setattr(task_module, "ModelProviderService", MagicMock(return_value=provider_service))

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._activate_managed_credential("tenant-1", "credential-1")

    assert exc_info.value.error_code == "tokener_provider_credential_activation_failed"
    assert "provider secret" not in str(exc_info.value)


def test_set_default_llm_wraps_provider_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    provider_service = MagicMock()
    provider_service.update_default_model_of_model_type.side_effect = RuntimeError("provider secret")
    monkeypatch.setattr(task_module, "ModelProviderService", MagicMock(return_value=provider_service))

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._set_default_llm("tenant-1")

    assert exc_info.value.error_code == "tokener_default_model_configuration_failed"
    assert exc_info.value.stage == TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER


@pytest.mark.parametrize(
    ("resolution_error", "expected_code", "expected_retryable", "expected_stage"),
    [
        (
            task_module.InvalidModelBillingProfileError(),
            "tokener_model_billing_profile_invalid",
            False,
            TenantTokenerIntegrationStatus.FAILED,
        ),
        (
            task_module.ModelBillingProfileResolutionError(),
            "tokener_model_billing_profile_unavailable",
            True,
            TenantTokenerIntegrationStatus.PENDING,
        ),
    ],
)
def test_run_bootstrap_maps_profile_resolution_failures(
    resolution_error: Exception,
    expected_code: str,
    expected_retryable: bool,
    expected_stage: TenantTokenerIntegrationStatus,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        task_module.ModelBillingProfileService,
        "resolve",
        MagicMock(side_effect=resolution_error),
    )

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module._run_bootstrap("tenant-1")

    assert exc_info.value.error_code == expected_code
    assert exc_info.value.retryable is expected_retryable
    assert exc_info.value.stage == expected_stage


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


def test_task_is_noop_when_bootstrap_worker_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=False)
    redis_lock = MagicMock()
    monkeypatch.setattr(task_module.redis_client, "lock", redis_lock)

    task_module.bootstrap_tokener_tenant_task.run("tenant-1")

    redis_lock.assert_not_called()


def test_task_retries_when_tenant_lock_is_already_held(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    lock = MagicMock()
    lock.acquire.return_value = False
    monkeypatch.setattr(task_module.redis_client, "lock", MagicMock(return_value=lock))
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "retry", retry)

    with pytest.raises(Retry):
        task_module.bootstrap_tokener_tenant_task.run("tenant-1")

    retry_error = retry.call_args.kwargs["exc"]
    assert isinstance(retry_error, task_module._BootstrapStepError)
    assert retry_error.error_code == "tokener_bootstrap_locked"
    lock.release.assert_not_called()


def test_task_persists_non_retryable_failure_without_scheduling_retry(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    bootstrap_error = task_module._BootstrapStepError(
        "tokener_plugin_version_conflict",
        retryable=False,
        stage=TenantTokenerIntegrationStatus.INSTALLING_PLUGIN,
    )
    monkeypatch.setattr(task_module, "_run_bootstrap", MagicMock(side_effect=bootstrap_error))
    lock = MagicMock()
    lock.acquire.return_value = True
    monkeypatch.setattr(task_module.redis_client, "lock", MagicMock(return_value=lock))
    retry = MagicMock()
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "retry", retry)

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module.bootstrap_tokener_tenant_task.run(integration.tenant_id)

    assert exc_info.value is bootstrap_error
    retry.assert_not_called()
    lock.release.assert_called_once_with()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.status == TenantTokenerIntegrationStatus.FAILED
    assert persisted.last_error_code == "tokener_plugin_version_conflict"


def test_task_sanitizes_unexpected_failure_before_retry(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    monkeypatch.setattr(
        task_module,
        "_run_bootstrap",
        MagicMock(side_effect=RuntimeError("upstream response contained a secret")),
    )
    lock = MagicMock()
    lock.acquire.return_value = True
    monkeypatch.setattr(task_module.redis_client, "lock", MagicMock(return_value=lock))
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "retry", retry)

    with pytest.raises(Retry):
        task_module.bootstrap_tokener_tenant_task.run(integration.tenant_id)

    retry_error = retry.call_args.kwargs["exc"]
    assert isinstance(retry_error, task_module._BootstrapStepError)
    assert retry_error.error_code == "tokener_bootstrap_internal_error"
    assert "secret" not in str(retry_error)
    lock.release.assert_called_once_with()
    sqlite_session.expire_all()
    persisted = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert persisted is not None
    assert persisted.status == TenantTokenerIntegrationStatus.FAILED
    assert persisted.last_error_code == "tokener_bootstrap_internal_error"


def test_task_raises_sanitized_error_after_internal_retry_budget_is_exhausted(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(sqlite_session)
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    monkeypatch.setattr(task_module, "_run_bootstrap", MagicMock(side_effect=RuntimeError("sensitive details")))
    lock = MagicMock()
    lock.acquire.return_value = True
    monkeypatch.setattr(task_module.redis_client, "lock", MagicMock(return_value=lock))
    retry = MagicMock()
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "retry", retry)
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task.request, "retries", task_module._MAX_RETRIES)

    with pytest.raises(task_module._BootstrapStepError) as exc_info:
        task_module.bootstrap_tokener_tenant_task.run(integration.tenant_id)

    assert exc_info.value.error_code == "tokener_bootstrap_internal_error"
    assert "sensitive details" not in str(exc_info.value)
    retry.assert_not_called()
    lock.release.assert_called_once_with()


def test_task_does_not_mask_success_when_lock_expired_before_release(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    run_bootstrap = MagicMock()
    monkeypatch.setattr(task_module, "_run_bootstrap", run_bootstrap)
    lock = MagicMock()
    lock.acquire.return_value = True
    lock.release.side_effect = RuntimeError("lock expired")
    monkeypatch.setattr(task_module.redis_client, "lock", MagicMock(return_value=lock))

    task_module.bootstrap_tokener_tenant_task.run("tenant-1")

    run_bootstrap.assert_called_once_with("tenant-1")
    lock.release.assert_called_once_with()


def test_recovery_sweeper_is_noop_when_bootstrap_worker_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=False)
    delay = MagicMock()
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "delay", delay)

    assert task_module.sweep_pending_tokener_integrations_task.run() == 0
    delay.assert_not_called()


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


@pytest.mark.parametrize(
    ("create_profile", "profile_source"),
    [
        (False, None),
        (True, None),
    ],
)
def test_recovery_sweeper_ignores_integrations_without_explicit_tokener_profile(
    create_profile: bool,
    profile_source: str | None,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    integration = _persist_integration(
        sqlite_session,
        create_profile=create_profile,
        profile_source=profile_source,
    )
    integration.updated_at = naive_utc_now() - timedelta(minutes=10)
    sqlite_session.commit()
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True,
        TOKENER_BOOTSTRAP_RECOVERY_TASK_INTERVAL=5,
        TOKENER_BOOTSTRAP_RECOVERY_BATCH_SIZE=100,
    )
    delay = MagicMock()
    monkeypatch.setattr(task_module.bootstrap_tokener_tenant_task, "delay", delay)

    assert task_module.sweep_pending_tokener_integrations_task.run() == 0
    delay.assert_not_called()
