"""Application contract tests for transport-neutral IM synchronization commands."""

from __future__ import annotations

import logging
from datetime import datetime

import pytest

from core.human_input_v2.entities import IMProvider, IMSyncResultType
from core.human_input_v2.im_integration import (
    ActiveRunDecision,
    ActiveRunDecisionKind,
    EncryptedCredentials,
    IMIntegration,
    IMSyncRun,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    StaleRevision,
    SyncResultPage,
)
from core.human_input_v2.shared import (
    AccountId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from services.human_input_v2.im_contact_sync.errors import IMWriteUnavailableError
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLockUnavailableError
from services.human_input_v2.im_contact_sync.service import (
    IMIntegrationNotConfiguredError,
    IMSyncDispatchUnavailableError,
    IMSyncRevisionChangedError,
    IMSyncRunNotFoundError,
    IMSyncService,
)

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("workspace-1")
_SCOPE = WorkspaceScope(id=_TENANT_ID)


def _integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=_TENANT_ID,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
        now=_NOW,
    )


def _run(run_id: str = "run-1") -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId(run_id),
        integration_revision=IntegrationRevisionToken(IntegrationId("integration-1"), 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=AccountId("account-1"),
        now=_NOW,
    )


class _Repository:
    def __init__(self, decision: ActiveRunDecision, latest_run: IMSyncRun | None = None) -> None:
        self.integration: IMIntegration | None = _integration()
        self.decision = decision
        self.latest_run = latest_run
        self.result_page = SyncResultPage((), page=1, limit=20, total=0)
        self.page_request: tuple[IMSyncRunId, IMSyncResultType, int, int] | None = None
        self.identity_page = object()
        self.identity_request: tuple[IntegrationId, IMProvider, str | None, int, int] | None = None

    def load_current_integration(self, tenant_id: TenantId | None) -> IMIntegration | None:
        assert tenant_id == _TENANT_ID
        return self.integration

    def create_or_get_active_run(
        self,
        integration_revision: IntegrationRevisionToken,
        *,
        organization_scope: WorkspaceScope,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: datetime,
    ) -> ActiveRunDecision:
        assert integration_revision == _integration().revision
        assert organization_scope == _SCOPE
        assert sync_run_id == IMSyncRunId("generated-run")
        assert started_by_account_id == AccountId("account-1")
        assert now == _NOW
        return self.decision

    def load_latest_sync_run(self, integration_id: IntegrationId) -> IMSyncRun | None:
        assert integration_id == IntegrationId("integration-1")
        return self.latest_run

    def page_sync_results(
        self,
        sync_run_id: IMSyncRunId,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        self.page_request = (sync_run_id, result_type, page, limit)
        return self.result_page

    def search_identities(
        self,
        integration_id: IntegrationId,
        provider: IMProvider,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> object:
        self.identity_request = (integration_id, provider, keyword, page, limit)
        return self.identity_page


def test_created_run_is_dispatched_once_after_persistence() -> None:
    created_run = _run()
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.CREATED, created_run))
    dispatched: list[tuple[IMSyncRunId, WorkspaceScope]] = []
    service = IMSyncService(
        repository,
        lambda run_id, scope: dispatched.append((run_id, scope)),
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    result = service.create_or_get_active_run(_SCOPE, AccountId("account-1"))

    assert result == created_run
    assert dispatched == [(created_run.id, _SCOPE)]


def test_existing_queued_run_is_dispatched_again() -> None:
    active_run = _run()
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.EXISTING_ACTIVE, active_run))
    dispatched: list[tuple[IMSyncRunId, WorkspaceScope]] = []
    service = IMSyncService(
        repository,
        lambda run_id, scope: dispatched.append((run_id, scope)),
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    result = service.create_or_get_active_run(_SCOPE, AccountId("account-1"))

    assert result == active_run
    assert dispatched == [(active_run.id, _SCOPE)]


def test_existing_running_run_is_not_dispatched_again() -> None:
    active_run = _run().start(_NOW)
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.EXISTING_ACTIVE, active_run))
    dispatched: list[tuple[IMSyncRunId, WorkspaceScope]] = []
    service = IMSyncService(
        repository,
        lambda run_id, scope: dispatched.append((run_id, scope)),
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    result = service.create_or_get_active_run(_SCOPE, AccountId("account-1"))

    assert result == active_run
    assert dispatched == []


def test_dispatch_failure_is_logged_and_raised_as_retryable_application_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    created_run = _run()
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.CREATED, created_run))

    def dispatch(_run_id: IMSyncRunId, _scope: WorkspaceScope) -> None:
        raise ConnectionError("queue unavailable")

    service = IMSyncService(
        repository,
        dispatch,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError) as error_info:
        service.create_or_get_active_run(_SCOPE, AccountId("account-1"))

    assert isinstance(error_info.value, IMSyncDispatchUnavailableError)
    assert isinstance(error_info.value.__cause__, ConnectionError)
    assert "run-1" in caplog.text
    assert "integration-1" in caplog.text


def test_run_creation_maps_lock_unavailable_to_retryable_application_error() -> None:
    class LockUnavailableRepository(_Repository):
        def create_or_get_active_run(self, *_args, **_kwargs) -> ActiveRunDecision:
            raise OrganizationIMWriteLockUnavailableError("busy")

    repository = LockUnavailableRepository(ActiveRunDecision(ActiveRunDecisionKind.CREATED, _run()))
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    with pytest.raises(RuntimeError) as error_info:
        service.create_or_get_active_run(_SCOPE, AccountId("account-1"))

    assert isinstance(error_info.value, IMWriteUnavailableError)
    assert isinstance(error_info.value.__cause__, OrganizationIMWriteLockUnavailableError)


def test_run_creation_maps_missing_integration_and_stale_revision() -> None:
    expected_revision = _integration().revision
    repository = _Repository(
        ActiveRunDecision(
            ActiveRunDecisionKind.STALE_REVISION,
            None,
            StaleRevision(expected_revision, IntegrationRevisionToken(expected_revision.integration_id, 2)),
        )
    )
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    with pytest.raises(IMSyncRevisionChangedError):
        service.create_or_get_active_run(_SCOPE, AccountId("account-1"))

    repository.integration = None
    with pytest.raises(IMIntegrationNotConfiguredError):
        service.create_or_get_active_run(_SCOPE, AccountId("account-1"))


def test_run_creation_rejects_repository_decision_without_a_run() -> None:
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.EXISTING_ACTIVE, None))
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    with pytest.raises(RuntimeError, match="active run decision is missing its run"):
        service.create_or_get_active_run(_SCOPE, AccountId("account-1"))


def test_latest_summary_and_required_bucket_page_use_current_integration() -> None:
    latest_run = _run("latest-run")
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.EXISTING_ACTIVE, latest_run), latest_run)
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    assert service.get_latest_run(_SCOPE) == latest_run
    assert service.list_latest_results(_SCOPE, IMSyncResultType.NOT_MATCHED, page=2, limit=10) == repository.result_page
    assert repository.page_request == (latest_run.id, IMSyncResultType.NOT_MATCHED, 2, 10)


def test_latest_queries_fail_closed_without_current_run() -> None:
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.CREATED, _run()))
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    with pytest.raises(IMSyncRunNotFoundError):
        service.get_latest_run(_SCOPE)
    with pytest.raises(IMSyncRunNotFoundError):
        service.list_latest_results(_SCOPE, IMSyncResultType.ADDED, page=1, limit=20)


def test_identity_search_uses_current_integration_and_remains_run_independent() -> None:
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.CREATED, _run()))
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    result = service.search_identities(_SCOPE, keyword=" reviewer ", page=2, limit=10)

    assert result is repository.identity_page
    assert repository.identity_request == (
        IntegrationId("integration-1"),
        IMProvider.FEISHU,
        " reviewer ",
        2,
        10,
    )


@pytest.mark.parametrize(("page", "limit"), [(0, 20), (1, 0), (1, 101)])
def test_latest_result_paging_rejects_invalid_bounds(page: int, limit: int) -> None:
    latest_run = _run("latest-run")
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.EXISTING_ACTIVE, latest_run), latest_run)
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    with pytest.raises(ValueError, match="page|limit"):
        service.list_latest_results(_SCOPE, IMSyncResultType.ADDED, page=page, limit=limit)


@pytest.mark.parametrize(("page", "limit"), [(0, 20), (1, 0), (1, 101)])
def test_identity_search_rejects_invalid_bounds(page: int, limit: int) -> None:
    repository = _Repository(ActiveRunDecision(ActiveRunDecisionKind.CREATED, _run()))
    service = IMSyncService(
        repository,
        lambda _run_id, _scope: None,
        clock=lambda: _NOW,
        run_id_factory=lambda: IMSyncRunId("generated-run"),
    )

    with pytest.raises(ValueError, match="page|limit"):
        service.search_identities(_SCOPE, keyword=None, page=page, limit=limit)
