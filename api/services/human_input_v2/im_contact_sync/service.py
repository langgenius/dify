"""Transport-neutral commands and queries for manual IM directory sync."""

from __future__ import annotations

import logging
from collections.abc import Callable

from pydantic import NaiveDatetime

from core.human_input_v2.entities import IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    IMIntegration,
    IMSyncRepository,
    IMSyncRun,
    SynchronizedIMIdentityPage,
    SyncResultPage,
)
from core.human_input_v2.shared import (
    AccountId,
    DeploymentScope,
    DirectoryScope,
    IMSyncRunId,
    TenantId,
    WorkspaceScope,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .errors import IMWriteUnavailableError
from .locking import OrganizationIMWriteLockLostError, OrganizationIMWriteLockUnavailableError

logger = logging.getLogger(__name__)


class IMIntegrationNotConfiguredError(RuntimeError):
    """No current Integration exists for the requested Organization."""


class IMSyncRevisionChangedError(RuntimeError):
    """The Integration revision changed while a sync run was being created."""


class IMSyncRunNotFoundError(RuntimeError):
    """The current Integration has no persisted synchronization run."""


class IMSyncDispatchUnavailableError(RuntimeError):
    """A persisted queued run could not be dispatched for asynchronous execution."""


type IMSyncRunDispatcher = Callable[[IMSyncRunId, DirectoryScope], None]


class IMSyncService:
    """Create durable runs and expose latest-only synchronization queries."""

    def __init__(
        self,
        repository: IMSyncRepository,
        dispatcher: IMSyncRunDispatcher,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        run_id_factory: Callable[[], IMSyncRunId] = lambda: IMSyncRunId(str(uuidv7())),
    ) -> None:
        self._repository = repository
        self._dispatcher = dispatcher
        self._clock = clock
        self._run_id_factory = run_id_factory

    def create_or_get_active_run(
        self,
        organization_scope: DirectoryScope,
        started_by_account_id: AccountId | None,
    ) -> IMSyncRun:
        integration = self._require_current_integration(organization_scope)
        try:
            decision = self._repository.create_or_get_active_run(
                integration.revision,
                organization_scope=organization_scope,
                sync_run_id=self._run_id_factory(),
                started_by_account_id=started_by_account_id,
                now=self._clock(),
            )
        except (OrganizationIMWriteLockUnavailableError, OrganizationIMWriteLockLostError) as error:
            raise IMWriteUnavailableError("IM write is temporarily unavailable") from error
        if decision.kind is ActiveRunDecisionKind.STALE_REVISION:
            raise IMSyncRevisionChangedError("IM Integration revision changed during sync run creation")
        if decision.run is None:
            raise RuntimeError("active run decision is missing its run")
        if decision.run.status is IMSyncRunStatus.QUEUED:
            try:
                self._dispatcher(decision.run.id, organization_scope)
            except Exception as error:
                logger.exception(
                    "Failed to dispatch IM Contact sync run, sync_run_id=%s, integration_id=%s",
                    decision.run.id,
                    decision.run.integration_revision.integration_id,
                )
                raise IMSyncDispatchUnavailableError(
                    "IM synchronization dispatch is temporarily unavailable"
                ) from error
        return decision.run

    def get_latest_run(self, organization_scope: DirectoryScope) -> IMSyncRun:
        integration = self._require_current_integration(organization_scope)
        run = self._repository.load_latest_sync_run(integration.id)
        if run is None:
            raise IMSyncRunNotFoundError("IM Integration has no synchronization run")
        return run

    def list_latest_results(
        self,
        organization_scope: DirectoryScope,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        latest_run = self.get_latest_run(organization_scope)
        return self._repository.page_sync_results(
            latest_run.id,
            result_type,
            page=page,
            limit=limit,
        )

    def search_identities(
        self,
        organization_scope: DirectoryScope,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> SynchronizedIMIdentityPage:
        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        integration = self._require_current_integration(organization_scope)
        return self._repository.search_identities(
            integration.id,
            integration.provider_tenant.provider,
            keyword=keyword,
            page=page,
            limit=limit,
        )

    def _require_current_integration(self, organization_scope: DirectoryScope) -> IMIntegration:
        tenant_id = _tenant_id(organization_scope)
        integration = self._repository.load_current_integration(tenant_id)
        if integration is None:
            raise IMIntegrationNotConfiguredError("Organization has no IM Integration")
        return integration


def _tenant_id(organization_scope: DirectoryScope) -> TenantId | None:
    if isinstance(organization_scope, WorkspaceScope):
        return organization_scope.id
    if isinstance(organization_scope, DeploymentScope):
        return None
    raise TypeError("unsupported Organization scope")


__all__ = [
    "IMIntegrationNotConfiguredError",
    "IMSyncDispatchUnavailableError",
    "IMSyncRevisionChangedError",
    "IMSyncRunDispatcher",
    "IMSyncRunNotFoundError",
    "IMSyncService",
    "IMWriteUnavailableError",
]
