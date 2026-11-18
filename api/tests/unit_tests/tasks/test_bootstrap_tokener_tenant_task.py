"""Native signup worker contracts using real persistence and normal protocol DTOs."""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from celery.exceptions import Retry
from pytest_mock import MockerFixture
from redis.lock import Lock
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.entities.provider_configuration import ProviderConfiguration
from core.plugin.entities.plugin_daemon import (
    PluginInstallTask,
    PluginInstallTaskStartResponse,
    PluginInstallTaskStatus,
)
from enums.model_billing import TenantTokenerIntegrationStatus
from extensions.ext_redis import RedisClientWrapper
from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Tenant
from models.model import TenantCreditPool
from models.model_billing import TenantModelBillingProfile
from models.provider import Provider, ProviderCredential, ProviderType, TenantDefaultModel
from models.tokener import TenantTokenerIntegration
from services.billing_service import TokenerTenantBootstrapResponse
from tasks import bootstrap_tokener_tenant_task as module
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.core.model_fixtures import make_model_config

PROVIDER = "langgenius/tokener/tokener"
# A protocol fixture identifier, not a runtime latest-provider requirement.
PLUGIN_UID = "langgenius/tokener:0.4.4@" + "a" * 64
ENDPOINT = "https://api-dev.tokener.dev/v1"
TEST_KEY = "ONE_TIME_TEST_KEY_NOT_A_REAL_CREDENTIAL"


@pytest.fixture(autouse=True)
def native_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True,
        TOKENER_PLUGIN_INSTALL_SOURCE="marketplace",
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER=PLUGIN_UID,
        TOKENER_PROVIDER_NAME=PROVIDER,
        TOKENER_ENDPOINT_URL=ENDPOINT,
        TOKENER_DEFAULT_LLM_MODEL="gpt-4o-mini",
    )


def persist_native(
    session: Session,
    *,
    include_profile: bool = True,
    source: str | None = "tokener",
    status: TenantTokenerIntegrationStatus = TenantTokenerIntegrationStatus.PENDING,
    install_task_id: str | None = None,
) -> TenantTokenerIntegration:
    tenant = Tenant(name="Native signup worker test")
    session.add(tenant)
    session.flush()
    integration = TenantTokenerIntegration(
        tenant_id=tenant.id,
        status=status,
        plugin_unique_identifier=PLUGIN_UID,
        plugin_install_task_id=install_task_id,
    )
    session.add(integration)
    if include_profile:
        session.add(TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source=source))
    session.commit()
    return integration


def snapshot(integration: TenantTokenerIntegration) -> module._IntegrationSnapshot:
    return module._IntegrationSnapshot(
        tenant_id=integration.tenant_id,
        tenant_name="Native signup worker test",
        status=integration.status,
        plugin_unique_identifier=integration.plugin_unique_identifier,
        plugin_install_task_id=integration.plugin_install_task_id,
    )


def ready_response(tenant_id: str) -> TokenerTenantBootstrapResponse:
    return {"tenant_id": tenant_id, "status": "ready", "retryable": False, "data_plane_api_key": TEST_KEY}


@dataclass
class NativeProviderEffects:
    validation_inputs: list[dict[str, str]] = field(default_factory=list)
    activated: list[tuple[str, str]] = field(default_factory=list)
    defaults: list[tuple[str, str, str]] = field(default_factory=list)


@pytest.fixture
def provider_effects(mocker: MockerFixture, sqlite_session_factory: sessionmaker[Session]) -> NativeProviderEffects:
    """Supply only plugin validation/activation I/O; keep encrypted binding SQL real."""
    effects = NativeProviderEffects()

    def configuration(tenant_id: str, provider: str) -> ProviderConfiguration:
        assert provider == PROVIDER
        value = make_model_config(
            provider=provider, model="gpt-4o-mini", mode="chat"
        ).provider_model_bundle.configuration
        value.tenant_id = tenant_id
        return value

    def validate(credentials: dict[str, str]) -> dict[str, str]:
        effects.validation_inputs.append(dict(credentials))
        return {"api_key": "ENCRYPTED_TEST_ONLY"}

    def activate(*, tenant_id: str, provider: str, credential_id: str) -> None:
        assert provider == PROVIDER
        with sqlite_session_factory.begin() as session:
            row = session.scalar(
                select(Provider).where(Provider.tenant_id == tenant_id, Provider.provider_name == provider)
            )
            if row is None:
                session.add(
                    Provider(
                        tenant_id=tenant_id,
                        provider_name=provider,
                        provider_type=ProviderType.CUSTOM,
                        credential_id=credential_id,
                        is_valid=True,
                    )
                )
            else:
                row.credential_id, row.is_valid = credential_id, True
        effects.activated.append((tenant_id, credential_id))

    def set_default(*, tenant_id: str, pinned: tuple[str, str]) -> None:
        provider, model = pinned
        assert provider == PROVIDER
        with sqlite_session_factory.begin() as session:
            session.add(
                TenantDefaultModel(
                    tenant_id=tenant_id, provider_name=provider, model_name=model, model_type=ModelType.LLM
                )
            )
        effects.defaults.append((tenant_id, provider, model))

    mocker.patch.object(module.ModelProviderService, "_get_provider_configuration", side_effect=configuration)
    mocker.patch.object(ProviderConfiguration, "validate_provider_credentials", side_effect=validate)
    mocker.patch.object(module.ModelProviderService, "activate_unselected_provider_credential", side_effect=activate)
    mocker.patch.object(module.ModelProviderService, "initialize_default_llm", side_effect=set_default)
    return effects


def install_immediately(mocker: MockerFixture) -> None:
    mocker.patch.object(module.PluginService, "list", return_value=[])
    mocker.patch.object(
        module.PluginService,
        "install_from_marketplace_pkg",
        return_value=PluginInstallTaskStartResponse(all_installed=True, task_id=""),
    )


def test_native_ready_consumes_key_binds_encrypted_credential_and_sets_exact_default(
    sqlite_session: Session, mocker: MockerFixture, provider_effects: NativeProviderEffects
) -> None:
    integration = persist_native(sqlite_session)
    response = ready_response(integration.tenant_id)
    upstream = mocker.patch.object(module.BillingService, "bootstrap_tokener_tenant", return_value=response)
    install_immediately(mocker)

    module._run_bootstrap(integration.tenant_id)

    sqlite_session.expire_all()
    row = sqlite_session.get(TenantTokenerIntegration, integration.id)
    assert row is not None
    assert row.status == TenantTokenerIntegrationStatus.READY
    assert row.provider_credential_id is not None
    assert row.ready_at is not None
    assert row.attempt_count == 1
    credential = sqlite_session.get(ProviderCredential, row.provider_credential_id)
    assert credential is not None
    assert "ENCRYPTED_TEST_ONLY" in credential.encrypted_config
    assert TEST_KEY not in credential.encrypted_config
    assert "data_plane_api_key" not in response
    assert module._find_managed_credential(integration.tenant_id) == (credential.id, True)
    assert provider_effects.validation_inputs == [{"api_key": TEST_KEY, "endpoint_url": ENDPOINT}]
    assert provider_effects.defaults == [(integration.tenant_id, PROVIDER, "gpt-4o-mini")]
    assert (
        sqlite_session.scalar(select(TenantCreditPool).where(TenantCreditPool.tenant_id == integration.tenant_id))
        is None
    )
    upstream.assert_called_once_with(integration.tenant_id, "Native signup worker test")


def test_native_ready_replay_does_not_repeat_remote_provision_or_credential_write(
    sqlite_session: Session, mocker: MockerFixture, provider_effects: NativeProviderEffects
) -> None:
    integration = persist_native(sqlite_session)
    upstream = mocker.patch.object(
        module.BillingService, "bootstrap_tokener_tenant", return_value=ready_response(integration.tenant_id)
    )
    install_immediately(mocker)
    module._run_bootstrap(integration.tenant_id)
    module._run_bootstrap(integration.tenant_id)
    upstream.assert_called_once()
    assert (
        len(provider_effects.validation_inputs)
        == len(provider_effects.activated)
        == len(provider_effects.defaults)
        == 1
    )
    assert len(list(sqlite_session.scalars(select(ProviderCredential)))) == 1


@pytest.mark.parametrize("include_profile", [False, True])
def test_legacy_missing_or_null_profile_never_initializes_tokener(
    sqlite_session: Session, mocker: MockerFixture, include_profile: bool
) -> None:
    integration = persist_native(sqlite_session, include_profile=include_profile, source=None)
    install = mocker.patch.object(module.PluginService, "list")
    upstream = mocker.patch.object(module.BillingService, "bootstrap_tokener_tenant")
    module._run_bootstrap(integration.tenant_id)
    install.assert_not_called()
    upstream.assert_not_called()
    sqlite_session.expire_all()
    assert integration.attempt_count == 0
    assert sqlite_session.scalar(select(ProviderCredential)) is None


def test_pending_resources_retry_is_sanitized_and_persisted_without_any_key_or_payout(
    sqlite_session: Session,
    mocker: MockerFixture,
    redis_transport: tuple[RedisClientWrapper, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    integration = persist_native(sqlite_session)
    install_immediately(mocker)
    mocker.patch.object(
        module.BillingService,
        "bootstrap_tokener_tenant",
        return_value={
            "tenant_id": integration.tenant_id,
            "status": "pending",
            "retryable": True,
            "error_code": "tokener_bootstrap_pending",
        },
    )
    redis, _commands = redis_transport
    monkeypatch.setattr(module, "redis_client", redis)
    mocker.patch.object(Lock, "acquire", return_value=True)
    mocker.patch.object(Lock, "release")
    retry = mocker.patch.object(module.bootstrap_tokener_tenant_task, "retry", side_effect=Retry())
    with pytest.raises(Retry):
        module.bootstrap_tokener_tenant_task.run(integration.tenant_id)
    retry.assert_called_once()
    call = retry.call_args
    assert call is not None
    assert call.kwargs["countdown"] == module._RETRY_DELAY_SECONDS
    assert isinstance(call.kwargs["exc"], module._BootstrapStepError)
    sqlite_session.expire_all()
    assert integration.status == TenantTokenerIntegrationStatus.PROVISIONING
    assert integration.last_error_code == "tokener_bootstrap_pending"
    assert sqlite_session.scalar(select(ProviderCredential)) is None


def test_unexpected_error_remains_pending_and_sweep_recovers_committed_credential(
    sqlite_session: Session,
    mocker: MockerFixture,
    provider_effects: NativeProviderEffects,
    redis_transport: tuple[RedisClientWrapper, object],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    integration = persist_native(sqlite_session)
    upstream = mocker.patch.object(
        module.BillingService, "bootstrap_tokener_tenant", return_value=ready_response(integration.tenant_id)
    )
    install_immediately(mocker)
    fault = mocker.patch.object(module, "_set_default_llm", side_effect=RuntimeError(TEST_KEY))
    redis, _commands = redis_transport
    monkeypatch.setattr(module, "redis_client", redis)
    mocker.patch.object(Lock, "acquire", return_value=True)
    mocker.patch.object(Lock, "release")
    retry = mocker.patch.object(module.bootstrap_tokener_tenant_task, "retry", side_effect=Retry())
    with monkeypatch.context() as request:
        request.setattr(module.bootstrap_tokener_tenant_task.request, "retries", 2)
        with pytest.raises(Retry):
            module.bootstrap_tokener_tenant_task.run(integration.tenant_id)

    sqlite_session.expire_all()
    bound_id = integration.provider_credential_id
    assert bound_id is not None
    assert integration.status == TenantTokenerIntegrationStatus.PENDING
    assert integration.last_error_code == "tokener_bootstrap_internal_error"
    assert TEST_KEY not in caplog.text
    retry.assert_called_once()
    call = retry.call_args
    assert call is not None
    assert call.kwargs["countdown"] == 20
    assert isinstance(call.kwargs["exc"], module._BootstrapStepError)

    # A lost retry delivery must remain visible to the normal beat sweep.
    future = module.naive_utc_now() + timedelta(minutes=module.dify_config.TOKENER_BOOTSTRAP_RECOVERY_TASK_INTERVAL + 1)
    dispatch = mocker.patch.object(module.bootstrap_tokener_tenant_task, "delay")
    with monkeypatch.context() as clock:
        clock.setattr(module, "naive_utc_now", lambda: future)
        assert module.sweep_pending_tokener_integrations_task.run() == 1
    dispatch.assert_called_once_with(integration.tenant_id)

    mocker.stop(fault)
    module.bootstrap_tokener_tenant_task.run(integration.tenant_id)
    sqlite_session.expire_all()
    assert integration.status == TenantTokenerIntegrationStatus.READY
    assert integration.provider_credential_id == bound_id
    upstream.assert_called_once()
    assert len(provider_effects.validation_inputs) == 1
    assert len(list(sqlite_session.scalars(select(ProviderCredential)))) == 1


def test_unexpected_error_after_retry_budget_is_terminal_and_preserves_progress(
    sqlite_session: Session,
    mocker: MockerFixture,
    redis_transport: tuple[RedisClientWrapper, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    integration = persist_native(sqlite_session, install_task_id="native-install-task")
    credential = ProviderCredential(
        tenant_id=integration.tenant_id,
        provider_name=PROVIDER,
        credential_name=module.MANAGED_TOKENER_CREDENTIAL_NAME,
        encrypted_config='{"api_key":"ENCRYPTED_TEST_ONLY"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    integration.provider_credential_id = credential.id
    sqlite_session.commit()
    mocker.patch.object(module, "_run_bootstrap", side_effect=RuntimeError(TEST_KEY))
    redis, _commands = redis_transport
    monkeypatch.setattr(module, "redis_client", redis)
    mocker.patch.object(Lock, "acquire", return_value=True)
    mocker.patch.object(Lock, "release")
    retry = mocker.patch.object(module.bootstrap_tokener_tenant_task, "retry")
    with monkeypatch.context() as request:
        request.setattr(module.bootstrap_tokener_tenant_task.request, "retries", module._MAX_RETRIES)
        with pytest.raises(module._BootstrapStepError, match="^tokener_bootstrap_internal_error$"):
            module.bootstrap_tokener_tenant_task.run(integration.tenant_id)

    sqlite_session.expire_all()
    assert integration.status == TenantTokenerIntegrationStatus.FAILED
    assert integration.last_error_code == "tokener_bootstrap_internal_error"
    assert integration.provider_credential_id == credential.id
    assert integration.plugin_install_task_id == "native-install-task"
    retry.assert_not_called()
    future = module.naive_utc_now() + timedelta(minutes=module.dify_config.TOKENER_BOOTSTRAP_RECOVERY_TASK_INTERVAL + 1)
    monkeypatch.setattr(module, "naive_utc_now", lambda: future)
    dispatch = mocker.patch.object(module.bootstrap_tokener_tenant_task, "delay")
    assert module.sweep_pending_tokener_integrations_task.run() == 0
    dispatch.assert_not_called()


def test_activation_failure_reuses_committed_bound_id_without_second_upstream_grant(
    sqlite_session: Session, mocker: MockerFixture, provider_effects: NativeProviderEffects
) -> None:
    integration = persist_native(sqlite_session)
    response = ready_response(integration.tenant_id)
    upstream = mocker.patch.object(module.BillingService, "bootstrap_tokener_tenant", return_value=response)
    install_immediately(mocker)
    fault = mocker.patch.object(
        module, "_activate_managed_credential", side_effect=RuntimeError("activation interrupted")
    )
    with pytest.raises(module._BootstrapStepError):
        module._run_bootstrap(integration.tenant_id)
    sqlite_session.expire_all()
    bound = integration.provider_credential_id
    assert bound is not None
    assert "data_plane_api_key" not in response
    mocker.stop(fault)
    module._run_bootstrap(integration.tenant_id)
    sqlite_session.expire_all()
    assert integration.status == TenantTokenerIntegrationStatus.READY
    assert integration.provider_credential_id == bound
    upstream.assert_called_once()
    assert len(provider_effects.validation_inputs) == 1
    assert len(list(sqlite_session.scalars(select(ProviderCredential)))) == 1


def test_user_editable_managed_label_is_never_adopted_as_platform_binding(
    sqlite_session: Session, mocker: MockerFixture, provider_effects: NativeProviderEffects
) -> None:
    integration = persist_native(sqlite_session)
    byok = ProviderCredential(
        tenant_id=integration.tenant_id,
        provider_name=PROVIDER,
        credential_name=module.MANAGED_TOKENER_CREDENTIAL_NAME,
        encrypted_config='{"api_key":"PRIVATE_ORG_CREDENTIAL"}',
    )
    sqlite_session.add(byok)
    sqlite_session.commit()
    assert module._find_managed_credential(integration.tenant_id) == (None, False)
    upstream = mocker.patch.object(
        module.BillingService, "bootstrap_tokener_tenant", return_value=ready_response(integration.tenant_id)
    )
    credential_id = module._ensure_managed_credential(snapshot(integration))
    assert credential_id != byok.id
    sqlite_session.expire_all()
    assert byok.encrypted_config == '{"api_key":"PRIVATE_ORG_CREDENTIAL"}'
    managed = sqlite_session.get(ProviderCredential, credential_id)
    assert managed is not None
    assert managed.credential_name == module.MANAGED_TOKENER_CREDENTIAL_NAME + ":1"
    assert provider_effects.validation_inputs == [{"api_key": TEST_KEY, "endpoint_url": ENDPOINT}]
    upstream.assert_called_once()


def test_validation_failure_consumes_response_key_and_never_exposes_it_in_worker_frames(
    sqlite_session: Session, mocker: MockerFixture, provider_effects: NativeProviderEffects
) -> None:
    integration = persist_native(sqlite_session)
    response = ready_response(integration.tenant_id)
    mocker.patch.object(module.BillingService, "bootstrap_tokener_tenant", return_value=response)
    mocker.patch.object(ProviderConfiguration, "validate_provider_credentials", side_effect=RuntimeError(TEST_KEY))
    with pytest.raises(module._BootstrapStepError) as failure:
        module._ensure_managed_credential(snapshot(integration))
    assert failure.value.error_code == "tokener_provider_credential_rejected"
    assert TEST_KEY not in str(failure.value)
    assert "data_plane_api_key" not in response
    cursor = failure.value.__traceback__
    checked = False
    while cursor is not None:
        if cursor.tb_frame.f_code.co_filename.endswith("tasks/bootstrap_tokener_tenant_task.py"):
            checked = True
            assert TEST_KEY not in repr(cursor.tb_frame.f_locals)
        cursor = cursor.tb_next
    assert checked
    assert sqlite_session.scalar(select(ProviderCredential)) is None
    assert provider_effects.activated == []


def test_plugin_pending_response_persists_real_daemon_task_id(sqlite_session: Session, mocker: MockerFixture) -> None:
    integration = persist_native(sqlite_session)
    mocker.patch.object(module.PluginService, "list", return_value=[])
    install = mocker.patch.object(
        module.PluginService,
        "install_from_marketplace_pkg",
        return_value=PluginInstallTaskStartResponse(all_installed=False, task_id="native-install-task"),
    )
    with pytest.raises(module._BootstrapStepError) as failure:
        module._ensure_plugin_installed(snapshot(integration))
    assert failure.value.error_code == "tokener_plugin_install_pending"
    assert failure.value.retryable
    sqlite_session.expire_all()
    assert integration.plugin_install_task_id == "native-install-task"
    install.assert_called_once_with(integration.tenant_id, [PLUGIN_UID])


def test_inflight_install_task_never_starts_a_duplicate_install(sqlite_session: Session, mocker: MockerFixture) -> None:
    integration = persist_native(sqlite_session, install_task_id="native-install-task")
    stamp = datetime(2026, 1, 1, tzinfo=UTC)
    task = PluginInstallTask(
        id="native-install-task",
        created_at=stamp,
        updated_at=stamp,
        status=PluginInstallTaskStatus.Running,
        total_plugins=1,
        completed_plugins=0,
        plugins=[],
    )
    mocker.patch.object(module.PluginService, "list", return_value=[])
    mocker.patch.object(module.PluginService, "fetch_install_task", return_value=task)
    install = mocker.patch.object(module.PluginService, "install_from_marketplace_pkg")
    with pytest.raises(module._BootstrapStepError, match="^tokener_plugin_install_pending$"):
        module._ensure_plugin_installed(snapshot(integration))
    install.assert_not_called()
