"""Application orchestration tests for one complete IM Contact sync run."""

from __future__ import annotations

import logging
import traceback
from dataclasses import replace
from datetime import datetime
from types import TracebackType
from typing import Protocol, override

import pytest

from core.human_input_v2.entities import IMProvider, IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    ActiveRunDecision,
    ApplyReconciliationResult,
    ApplyReconciliationStatus,
    BlockedReconciliation,
    EncryptedCredentials,
    IMIntegration,
    IMSyncRepository,
    IMSyncRun,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    ReconciliationBlock,
    ReconciliationBlockCode,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationReasonCode,
    ReconciliationRunRef,
    ResolvedReconciliationWarning,
    SynchronizedIMIdentityPage,
    SyncResultPage,
)
from core.human_input_v2.im_integration.adapters import (
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    IMProviderAdapter,
)
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from services.human_input_v2.im_contact_sync import composition
from services.human_input_v2.im_contact_sync.composition import DifyIMIntegrationAdapterFactory
from services.human_input_v2.im_contact_sync.coordinator import (
    IMContactSyncCoordinator,
    IMSyncRetryableError,
)
from services.human_input_v2.im_contact_sync.locking import (
    OrganizationIMWriteLockLostError,
    OrganizationIMWriteLockUnavailableError,
)
from services.human_input_v2.im_credential_codec import IMCredentialError

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("workspace-1")
_SCOPE = WorkspaceScope(id=_TENANT_ID)


def _integration(tenant_id: TenantId | None = _TENANT_ID) -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )


def _queued_run(integration: IMIntegration | None = None) -> IMSyncRun:
    resolved_integration = integration or _integration()
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=resolved_integration.revision,
        provider=resolved_integration.provider_tenant.provider,
        started_by_account_id=None,
        now=_NOW,
    )


class _ReadRepository(IMSyncRepository):
    def __init__(
        self,
        integration: IMIntegration | None = None,
        expected_tenant_id: TenantId | None = _TENANT_ID,
    ) -> None:
        self.integration = integration or _integration()
        self.run = _queued_run(self.integration)
        self._expected_tenant_id = expected_tenant_id

    @override
    def load_current_integration(self, tenant_id: TenantId | None) -> IMIntegration | None:
        assert tenant_id == self._expected_tenant_id
        return self.integration

    @override
    def create_or_get_active_run(
        self,
        integration_revision: IntegrationRevisionToken,
        *,
        organization_scope: DirectoryScope,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: datetime,
    ) -> ActiveRunDecision:
        del integration_revision, organization_scope, sync_run_id, started_by_account_id, now
        raise AssertionError("run creation is outside the coordinator contract")

    @override
    def load_sync_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None:
        assert sync_run_id == self.run.id
        return self.run

    @override
    def load_latest_sync_run(self, integration_id: IntegrationId) -> IMSyncRun | None:
        del integration_id
        raise AssertionError("latest-run queries are outside the coordinator contract")

    @override
    def page_sync_results(
        self,
        sync_run_id: IMSyncRunId,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        del sync_run_id, result_type, page, limit
        raise AssertionError("result paging is outside the coordinator contract")

    @override
    def search_identities(
        self,
        integration_id: IntegrationId,
        provider: IMProvider,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> SynchronizedIMIdentityPage:
        del integration_id, provider, keyword, page, limit
        raise AssertionError("identity search is outside the coordinator contract")


class _DirectoryAdapter:
    provider = IMProvider.FEISHU

    def __init__(self, directory_result: Directory | DirectoryReadFailure, events: list[str]) -> None:
        self._directory_result = directory_result
        self._events = events
        self.directory = self

    def read_directory(self) -> Directory | DirectoryReadFailure:
        self._events.append("read_directory")
        return self._directory_result

    def close(self) -> None:
        self._events.append("close_adapter")


class _DirectoryAdapterFactory:
    def __init__(self, directory_result: Directory | DirectoryReadFailure, events: list[str]) -> None:
        self._directory_result = directory_result
        self._events = events

    def __call__(self, integration: IMIntegration) -> IMProviderAdapter:
        del integration
        return _DirectoryAdapter(self._directory_result, self._events)


class _ProtectedRepository:
    def __init__(self, read_repository: _ReadRepository, events: list[str]) -> None:
        self._read_repository = read_repository
        self._events = events
        self.apply_result = ApplyReconciliationResult(
            ApplyReconciliationStatus.APPLIED,
            IMSyncRunId("run-1"),
            _NOW,
            0,
            0,
            (),
        )
        self.apply_error: Exception | None = None

    def load_reconciliation_input(
        self,
        run: ReconciliationRunRef,
        directory_entries: tuple[DirectoryEntry, ...],
        contact_scope: DirectoryScope,
    ) -> ReconciliationInput:
        self._events.append("load_input")
        assert directory_entries == ()
        assert contact_scope == _SCOPE
        return ReconciliationInput(run, (), (), (), frozenset(), ())

    def apply_plan(self, plan: ReconciliationPlan, *, now: datetime) -> ApplyReconciliationResult:
        del plan
        self._events.append("apply_plan")
        assert now == _NOW
        if self.apply_error is not None:
            raise self.apply_error
        succeeded = self.apply_result.status in (
            ApplyReconciliationStatus.APPLIED,
            ApplyReconciliationStatus.ALREADY_APPLIED,
        )
        self._read_repository.run = replace(
            self._read_repository.run,
            status=IMSyncRunStatus.SUCCEEDED if succeeded else IMSyncRunStatus.FAILED,
            failed_count=0 if succeeded else 1,
            started_at=_NOW,
            finished_at=_NOW,
            error_code=None if succeeded else self.apply_result.status.value,
            updated_at=_NOW,
        )
        return self.apply_result

    def fail_run(
        self,
        sync_run_id: IMSyncRunId,
        status: ApplyReconciliationStatus,
        *,
        now: datetime,
        message: str,
    ) -> ApplyReconciliationResult:
        self._events.append(f"fail_run:{status.value}")
        self._read_repository.run = replace(
            self._read_repository.run,
            status=IMSyncRunStatus.FAILED,
            failed_count=1,
            started_at=_NOW,
            finished_at=_NOW,
            error_code=status.value,
            error_message=message,
            updated_at=_NOW,
        )
        return ApplyReconciliationResult(status, sync_run_id, now, 1, 0, ())


class _UnitOfWork:
    def __init__(self, repository: _ProtectedRepository, events: list[str], enter_error: Exception | None) -> None:
        self._repository = repository
        self._events = events
        self._enter_error = enter_error

    def __enter__(self) -> _ProtectedRepository:
        self._events.append("enter_guard")
        if self._enter_error is not None:
            raise self._enter_error
        return self._repository

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exception_type, exception, traceback
        self._events.append("exit_guard")


class _UnitOfWorkFactory:
    def __init__(
        self,
        repository: _ProtectedRepository,
        events: list[str],
        expected_scope: DirectoryScope = _SCOPE,
    ) -> None:
        self._repository = repository
        self._events = events
        self._expected_scope = expected_scope
        self.enter_errors: list[Exception | None] = []

    def __call__(self, scope: DirectoryScope) -> _UnitOfWork:
        assert scope == self._expected_scope
        enter_error = self.enter_errors.pop(0) if self.enter_errors else None
        return _UnitOfWork(self._repository, self._events, enter_error)


class _Planner(Protocol):
    def generate_plan(
        self, reconciliation_input: ReconciliationInput
    ) -> ReconciliationPlan | BlockedReconciliation: ...


def _coordinator(
    directory_result: Directory | DirectoryReadFailure,
    *,
    planner: _Planner | None = None,
) -> tuple[IMContactSyncCoordinator, _ReadRepository, _ProtectedRepository, _UnitOfWorkFactory, list[str]]:
    events: list[str] = []
    read_repository = _ReadRepository()
    protected_repository = _ProtectedRepository(read_repository, events)
    unit_of_work_factory = _UnitOfWorkFactory(protected_repository, events)
    coordinator = IMContactSyncCoordinator(
        read_repository,
        _DirectoryAdapterFactory(directory_result, events),
        unit_of_work_factory,
        planner=planner,
        clock=lambda: _NOW,
    )
    return coordinator, read_repository, protected_repository, unit_of_work_factory, events


def test_complete_directory_is_read_before_guarded_load_and_apply() -> None:
    coordinator, read_repository, _protected, _factory, events = _coordinator(Directory(()))

    terminal_run = coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert terminal_run.status is IMSyncRunStatus.SUCCEEDED
    assert events == ["read_directory", "enter_guard", "load_input", "apply_plan", "exit_guard", "close_adapter"]


def test_directory_failure_persists_terminal_diagnostic_without_loading_input() -> None:
    coordinator, read_repository, _protected, _factory, events = _coordinator(
        DirectoryReadFailure("provider-safe failure")
    )

    terminal_run = coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert terminal_run.status is IMSyncRunStatus.FAILED
    assert terminal_run.error_code == ApplyReconciliationStatus.DIRECTORY_READ_FAILED.value
    assert events == [
        "read_directory",
        "enter_guard",
        "fail_run:directory_read_failed",
        "exit_guard",
        "close_adapter",
    ]


def test_blocked_plan_persists_terminal_diagnostic_without_apply() -> None:
    initial_run = _queued_run()
    blocked = BlockedReconciliation(
        ReconciliationRunRef(initial_run.id, initial_run.integration_revision, initial_run.provider),
        (ReconciliationBlock(ReconciliationBlockCode.INVALID_CURRENT_BINDING, "binding-1", "invalid binding"),),
    )

    class _BlockedPlanner:
        def generate_plan(self, reconciliation_input: ReconciliationInput) -> BlockedReconciliation:
            del reconciliation_input
            return blocked

    coordinator, read_repository, _protected, _factory, events = _coordinator(Directory(()), planner=_BlockedPlanner())

    terminal_run = coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert terminal_run.error_code == ApplyReconciliationStatus.PLAN_BLOCKED.value
    assert "apply_plan" not in events
    assert "fail_run:plan_blocked" in events
    assert events[-1] == "close_adapter"


@pytest.mark.parametrize(
    "lock_error",
    [
        OrganizationIMWriteLockUnavailableError("busy"),
        OrganizationIMWriteLockLostError("lost"),
    ],
)
def test_lock_failures_are_retryable_and_always_close_adapter(lock_error: Exception) -> None:
    coordinator, read_repository, _protected, factory, events = _coordinator(Directory(()))
    factory.enter_errors.append(lock_error)

    with pytest.raises(IMSyncRetryableError):
        coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert read_repository.run.status is IMSyncRunStatus.QUEUED
    assert events == ["read_directory", "enter_guard", "close_adapter"]


def test_resolved_collision_warning_logs_only_stable_identifiers(caplog: pytest.LogCaptureFixture) -> None:
    coordinator, read_repository, protected, _factory, _events = _coordinator(Directory(()))
    protected.apply_result = replace(
        protected.apply_result,
        warnings=(
            ResolvedReconciliationWarning(
                "warning-1",
                ReconciliationReasonCode.AMBIGUOUS_CONTACT_EMAIL,
                (IMIdentityId("identity-1"),),
                (ContactId("contact-1"), ContactId("contact-2")),
            ),
        ),
    )

    with caplog.at_level(logging.WARNING):
        coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert "run-1" in caplog.text
    assert "integration-1" in caplog.text
    assert "warning-1" in caplog.text
    assert "identity-1" in caplog.text
    assert "contact-1" in caplog.text
    assert "contact-2" in caplog.text
    assert "@" not in caplog.text


def test_precondition_failure_returns_the_persisted_terminal_run() -> None:
    coordinator, read_repository, protected, _factory, events = _coordinator(Directory(()))
    protected.apply_result = replace(
        protected.apply_result,
        status=ApplyReconciliationStatus.PRECONDITION_FAILED,
        result_count=1,
    )

    terminal_run = coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert terminal_run.status is IMSyncRunStatus.FAILED
    assert terminal_run.error_code == ApplyReconciliationStatus.PRECONDITION_FAILED.value
    assert events.count("apply_plan") == 1
    assert not any(event.startswith("fail_run") for event in events)


def test_unexpected_apply_failure_rolls_back_then_persists_safe_terminal_diagnostic() -> None:
    coordinator, read_repository, protected, _factory, events = _coordinator(Directory(()))
    protected.apply_error = RuntimeError("database detail must not escape")

    terminal_run = coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert terminal_run.status is IMSyncRunStatus.FAILED
    assert terminal_run.error_code == ApplyReconciliationStatus.UNEXPECTED_APPLY_FAILURE.value
    assert terminal_run.error_message == "IM reconciliation could not be applied."
    assert events == [
        "read_directory",
        "enter_guard",
        "load_input",
        "apply_plan",
        "exit_guard",
        "enter_guard",
        "fail_run:unexpected_apply_failure",
        "exit_guard",
        "close_adapter",
    ]


def test_stale_integration_is_failed_before_constructing_a_provider_adapter() -> None:
    coordinator, read_repository, _protected, _factory, events = _coordinator(Directory(()))
    read_repository.integration = replace(read_repository.integration, config_version=2)

    terminal_run = coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert terminal_run.error_code == ApplyReconciliationStatus.STALE_REVISION.value
    assert events == ["enter_guard", "fail_run:stale_revision", "exit_guard"]


def test_tenant_less_default_runtime_persists_safe_terminal_without_key_or_provider_io(
    caplog: pytest.LogCaptureFixture,
) -> None:
    deployment_scope = DeploymentScope()
    integration = _integration(tenant_id=None)
    read_repository = _ReadRepository(integration, expected_tenant_id=None)
    persistence_events: list[str] = []
    protected_repository = _ProtectedRepository(read_repository, persistence_events)
    unit_of_work_factory = _UnitOfWorkFactory(
        protected_repository,
        persistence_events,
        expected_scope=deployment_scope,
    )
    provider_events: list[str] = []

    def unexpected_provider_builder(_credentials: IMProviderCredentials) -> IMProviderAdapter:
        provider_events.append("build_adapter")
        raise AssertionError("tenant-less runtime must not construct a provider adapter")

    adapter_factory = DifyIMIntegrationAdapterFactory(
        cipher_resolver=composition._resolve_default_cipher,
        provider_adapter_factory=unexpected_provider_builder,
    )
    coordinator = IMContactSyncCoordinator(
        read_repository,
        adapter_factory,
        unit_of_work_factory,
        clock=lambda: _NOW,
    )

    with caplog.at_level(logging.WARNING):
        terminal_run = coordinator.reconcile(read_repository.run.id, deployment_scope)

    assert terminal_run.status is IMSyncRunStatus.FAILED
    assert terminal_run.error_code == ApplyReconciliationStatus.DIRECTORY_READ_FAILED.value
    assert terminal_run.error_message == "IM credential configuration is unavailable."
    assert provider_events == []
    assert persistence_events == [
        "enter_guard",
        "fail_run:directory_read_failed",
        "exit_guard",
    ]
    assert "IM Contact credentials are unavailable" in caplog.text
    assert "opaque-ciphertext" not in caplog.text
    assert "opaque-ciphertext" not in repr(terminal_run)


def _preserved_credential_error(raw_detail: str) -> IMCredentialError:
    error = IMCredentialError("IM credential configuration is unavailable")
    error.__cause__ = RuntimeError(raw_detail)
    error.__suppress_context__ = True
    return error


def test_credential_failure_stops_before_provider_io_and_persists_only_safe_terminal_data(
    caplog: pytest.LogCaptureFixture,
) -> None:
    events: list[str] = []
    read_repository = _ReadRepository()
    protected_repository = _ProtectedRepository(read_repository, events)
    unit_of_work_factory = _UnitOfWorkFactory(protected_repository, events)
    raw_detail = "raw-decryptor-plaintext-secret"

    class _CredentialFailureFactory:
        def __call__(self, integration: IMIntegration) -> IMProviderAdapter:
            del integration
            events.append("load_credentials")
            raise _preserved_credential_error(raw_detail)

    coordinator = IMContactSyncCoordinator(
        read_repository,
        _CredentialFailureFactory(),
        unit_of_work_factory,
        clock=lambda: _NOW,
    )

    with caplog.at_level(logging.WARNING):
        terminal_run = coordinator.reconcile(read_repository.run.id, _SCOPE)

    assert terminal_run.status is IMSyncRunStatus.FAILED
    assert terminal_run.error_code == ApplyReconciliationStatus.DIRECTORY_READ_FAILED.value
    assert terminal_run.error_message == "IM credential configuration is unavailable."
    assert events == [
        "load_credentials",
        "enter_guard",
        "fail_run:directory_read_failed",
        "exit_guard",
    ]
    assert "read_directory" not in events
    assert "IM Contact credentials are unavailable" in caplog.text
    assert raw_detail not in caplog.text
    assert "opaque-ciphertext" not in caplog.text
    assert raw_detail not in repr(terminal_run)
    assert "opaque-ciphertext" not in repr(terminal_run)


@pytest.mark.parametrize(
    "lock_error",
    [
        OrganizationIMWriteLockUnavailableError("busy"),
        OrganizationIMWriteLockLostError("lost"),
    ],
)
def test_credential_failure_lock_retry_traceback_does_not_chain_credential_cause(lock_error: Exception) -> None:
    events: list[str] = []
    read_repository = _ReadRepository()
    protected_repository = _ProtectedRepository(read_repository, events)
    unit_of_work_factory = _UnitOfWorkFactory(protected_repository, events)
    unit_of_work_factory.enter_errors.append(lock_error)
    raw_detail = "raw-decryptor-plaintext-secret"

    class _CredentialFailureFactory:
        def __call__(self, integration: IMIntegration) -> IMProviderAdapter:
            del integration
            raise _preserved_credential_error(raw_detail)

    coordinator = IMContactSyncCoordinator(
        read_repository,
        _CredentialFailureFactory(),
        unit_of_work_factory,
        clock=lambda: _NOW,
    )

    with pytest.raises(IMSyncRetryableError) as captured:
        coordinator.reconcile(read_repository.run.id, _SCOPE)

    rendered_traceback = "".join(traceback.format_exception(captured.value))
    assert captured.value.__cause__ is lock_error
    assert raw_detail not in rendered_traceback
    assert "IMCredentialError" not in rendered_traceback
    assert "opaque-ciphertext" not in rendered_traceback
    assert events == ["enter_guard"]
