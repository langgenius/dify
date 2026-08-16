"""Application orchestration tests for one complete IM Contact sync run."""

from __future__ import annotations

import logging
from dataclasses import replace
from datetime import datetime

import pytest

from core.human_input_v2.entities import IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    ApplyReconciliationResult,
    ApplyReconciliationStatus,
    BlockedReconciliation,
    EncryptedCredentials,
    IMIntegration,
    IMSyncRun,
    ProviderTenantIdentity,
    ReconciliationBlock,
    ReconciliationBlockCode,
    ReconciliationInput,
    ReconciliationReasonCode,
    ReconciliationRunRef,
    ResolvedReconciliationWarning,
)
from core.human_input_v2.im_provider import Directory, DirectoryReadFailure
from core.human_input_v2.shared import (
    ContactId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from services.human_input_v2.im_contact_sync.coordinator import (
    IMContactSyncCoordinator,
    IMSyncRetryableError,
)
from services.human_input_v2.im_contact_sync.locking import (
    OrganizationIMWriteLockLostError,
    OrganizationIMWriteLockUnavailableError,
)

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("workspace-1")
_SCOPE = WorkspaceScope(id=_TENANT_ID)


def _integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=_TENANT_ID,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )


def _queued_run() -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=_integration().revision,
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=_NOW,
    )


class _ReadRepository:
    def __init__(self) -> None:
        self.integration = _integration()
        self.run = _queued_run()

    def load_current_integration(self, tenant_id: TenantId | None) -> IMIntegration | None:
        assert tenant_id == _TENANT_ID
        return self.integration

    def load_sync_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None:
        assert sync_run_id == self.run.id
        return self.run


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
        directory_entries: tuple,
        contact_scope: WorkspaceScope,
    ) -> ReconciliationInput:
        self._events.append("load_input")
        assert directory_entries == ()
        assert contact_scope == _SCOPE
        return ReconciliationInput(run, (), (), (), frozenset(), ())

    def apply_plan(self, _plan, *, now: datetime) -> ApplyReconciliationResult:
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

    def __exit__(self, *_unused: object) -> None:
        self._events.append("exit_guard")


class _UnitOfWorkFactory:
    def __init__(self, repository: _ProtectedRepository, events: list[str]) -> None:
        self._repository = repository
        self._events = events
        self.enter_errors: list[Exception | None] = []

    def __call__(self, scope: WorkspaceScope) -> _UnitOfWork:
        assert scope == _SCOPE
        enter_error = self.enter_errors.pop(0) if self.enter_errors else None
        return _UnitOfWork(self._repository, self._events, enter_error)


def _coordinator(
    directory_result: Directory | DirectoryReadFailure,
    *,
    planner: object | None = None,
) -> tuple[IMContactSyncCoordinator, _ReadRepository, _ProtectedRepository, _UnitOfWorkFactory, list[str]]:
    events: list[str] = []
    read_repository = _ReadRepository()
    protected_repository = _ProtectedRepository(read_repository, events)
    unit_of_work_factory = _UnitOfWorkFactory(protected_repository, events)
    coordinator = IMContactSyncCoordinator(
        read_repository,
        lambda _integration: _DirectoryAdapter(directory_result, events),
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
        def generate_plan(self, _reconciliation_input: ReconciliationInput) -> BlockedReconciliation:
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
