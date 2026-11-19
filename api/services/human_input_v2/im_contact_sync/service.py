"""Transport-neutral commands and queries for manual IM directory sync."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import NaiveDatetime
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    IMSyncRun,
    SynchronizedIMIdentityPage,
    SyncResultPage,
)
from core.human_input_v2.im_integration.sync_records import AccountIMSyncInitiator, IMSyncInitiator
from core.human_input_v2.shared import DirectoryScope, IMSyncRunId
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputIMSyncRun
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.im_integration import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.account_ports import AccountSnapshotQuery

logger = logging.getLogger(__name__)


class IMChannelNotConfiguredError(Exception):
    """No current Channel exists for the requested owner."""


class IMSyncRevisionChangedError(RuntimeError):
    """The Channel revision changed while a sync run was being created."""


class IMSyncRunNotFoundError(RuntimeError):
    """The current Channel has no persisted synchronization run."""


class IMSyncDispatchUnavailableError(RuntimeError):
    """A persisted queued run could not be dispatched for asynchronous execution."""


type IMSyncRunDispatcher = Callable[[IMSyncRunId, DirectoryScope], None]
type IMChannelResolver = Callable[[Session, DirectoryScope], IMChannel | None]


@dataclass(frozen=True, slots=True)
class IMSyncRunSummary:
    """A persisted run with its currently resolvable Dify Account name.

    The name is empty for EE sys_users and deleted Accounts. CE/SaaS never
    resolves EE administrator identities.
    """

    run: IMSyncRun
    initiator_display_name: str


class IMSyncService:
    """Own Session boundaries around Channel-bound synchronization persistence."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        channel_resolver: IMChannelResolver,
        dispatcher: IMSyncRunDispatcher,
        *,
        account_query: AccountSnapshotQuery,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
        run_id_factory: Callable[[], IMSyncRunId] = lambda: IMSyncRunId(str(uuidv7())),
    ) -> None:
        self._session_factory = session_factory
        self._channel_resolver = channel_resolver
        self._dispatcher = dispatcher
        self._account_query = account_query
        self._clock = clock
        self._run_id_factory = run_id_factory

    def create_or_get_active_run(
        self,
        owner_scope: DirectoryScope,
        started_by: IMSyncInitiator,
    ) -> IMSyncRunSummary:
        """Create or reuse a run from one authenticated initiating identity.

        CE/SaaS supplies an Account ID; EE supplies a sys_users.id. Reusing an
        active run preserves its original initiator. Commit precedes dispatch;
        dispatch failure leaves the queued run available for retry. The returned
        display name is resolved from the Account after persistence, never stored.
        """
        with self._session_factory() as session, session.begin():
            channel = self._require_channel(session, owner_scope)
            decision = SQLAlchemyIMControlPlaneRepository(session, channel).create_or_get_active_run(
                sync_run_id=self._run_id_factory(),
                started_by=started_by,
                now=self._clock(),
            )
            if decision.kind is ActiveRunDecisionKind.STALE_REVISION:
                raise IMSyncRevisionChangedError("IM Channel revision changed during sync run creation")
        if decision.run is None:
            raise RuntimeError("active run decision is missing its run")
        if decision.run.status is IMSyncRunStatus.QUEUED:
            try:
                self._dispatcher(decision.run.id, owner_scope)
            except Exception as error:
                logger.exception("Failed to dispatch IM Contact sync run, sync_run_id=%s", decision.run.id)
                raise IMSyncDispatchUnavailableError(
                    "IM synchronization dispatch is temporarily unavailable"
                ) from error
        return self._summarize_run(decision.run)

    def get_latest_run(self, owner_scope: DirectoryScope) -> IMSyncRunSummary:
        """Read the current Channel's latest run and resolve its Account name."""
        return self._summarize_run(self._load_latest_run(owner_scope))

    def _load_latest_run(self, owner_scope: DirectoryScope) -> IMSyncRun:
        """Load the current Channel's latest run or raise the existing not-found error."""
        with self._session_factory() as session:
            channel = self._require_channel(session, owner_scope)
            run = SQLAlchemyIMControlPlaneRepository(session, channel).load_latest_sync_run()
        if run is None:
            raise IMSyncRunNotFoundError("IM Channel has no synchronization run")
        return run

    def list_latest_results(
        self,
        owner_scope: DirectoryScope,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        latest_run = self._load_latest_run(owner_scope)
        with self._session_factory() as session:
            channel = self._require_channel(session, owner_scope)
            return SQLAlchemyIMControlPlaneRepository(session, channel).page_sync_results(
                latest_run.id,
                result_type,
                page=page,
                limit=limit,
            )

    def search_identities(
        self,
        owner_scope: DirectoryScope,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> SynchronizedIMIdentityPage:
        with self._session_factory() as session:
            channel = self._require_channel(session, owner_scope)
            identities = SQLAlchemyIMIdentityRepository(session, channel.id)
            bindings = SQLAlchemyIMBindingRepository(session, channel.id)
            return SQLAlchemyIMControlPlaneRepository(session, channel).search_identities(
                identities,
                bindings,
                keyword=keyword,
                page=page,
                limit=limit,
            )

    def load_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None:
        with self._session_factory() as session:
            record = session.get(HumanInputIMSyncRun, str(sync_run_id))
            if record is None:
                return None
            from repositories.human_input_v2.im_integration.mappers import sync_run_from_record

            return sync_run_from_record(record)

    def _require_channel(self, session: Session, owner_scope: DirectoryScope) -> IMChannel:
        channel = self._channel_resolver(session, owner_scope)
        if channel is None:
            raise IMChannelNotConfiguredError("Owner has no IM Channel")
        return channel

    def _summarize_run(self, run: IMSyncRun) -> IMSyncRunSummary:
        """Resolve only Account initiators; EE names stay empty."""
        if not isinstance(run.started_by, AccountIMSyncInitiator):
            return IMSyncRunSummary(run, "")
        account = self._account_query.get(str(run.started_by.account_id))
        return IMSyncRunSummary(run, account.name if account is not None else "")


__all__ = [
    "IMChannelNotConfiguredError",
    "IMChannelResolver",
    "IMSyncDispatchUnavailableError",
    "IMSyncRevisionChangedError",
    "IMSyncRunDispatcher",
    "IMSyncRunNotFoundError",
    "IMSyncService",
]
