"""Caller-session SQLAlchemy persistence for historical IM synchronization."""

from __future__ import annotations

import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from core.human_input_v2.entities import IMIdentityBindingStatus, IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    ActiveRunDecision,
    ActiveRunDecisionKind,
    IMChannelRevision,
    IMSyncRun,
    StaleRevision,
    SynchronizedIMIdentity,
    SynchronizedIMIdentityPage,
    SyncResultFact,
    SyncResultPage,
)
from core.human_input_v2.shared import AccountId, IMSyncResultId, IMSyncRunId
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputIMChannel, HumanInputIMSyncResult, HumanInputIMSyncRun
from repositories.human_input_v2.im_binding_repository import IMBindingRepository
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId
from repositories.human_input_v2.im_identity_repository import IMIdentityRepository

from .mappers import sync_result_from_record, sync_result_to_record, sync_run_from_record, sync_run_to_record

_MAX_PAGE_LIMIT = 100


class SQLAlchemyIMControlPlaneRepository:
    """Historical sync persistence bound to one caller Session and current Channel."""

    def __init__(self, session: Session, channel: IMChannel) -> None:
        self._session = session
        self._channel = channel

    def create_or_get_active_run(
        self,
        *,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> ActiveRunDecision:
        revision = IMChannelRevision(
            str(self._channel.id),
            self._channel.config_version,
        )
        if not self._serialize_current_channel():
            return ActiveRunDecision(
                ActiveRunDecisionKind.STALE_REVISION,
                None,
                StaleRevision(revision, None),
            )
        active_records = self._session.scalars(
            sa.select(HumanInputIMSyncRun)
            .where(
                HumanInputIMSyncRun.channel_id == str(self._channel.id),
                HumanInputIMSyncRun.status.in_((IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING)),
            )
            .order_by(HumanInputIMSyncRun.created_at, HumanInputIMSyncRun.id)
            # A locking read also observes the previous lock holder's commit on
            # databases whose ordinary reads retain a transaction snapshot.
            .with_for_update()
        ).all()
        current_active: HumanInputIMSyncRun | None = None
        for active_record in active_records:
            if active_record.channel_config_version < self._channel.config_version:
                self._finish_stale_run(active_record, now)
            else:
                current_active = active_record
        if current_active is not None:
            return ActiveRunDecision(ActiveRunDecisionKind.EXISTING_ACTIVE, sync_run_from_record(current_active))
        run = IMSyncRun.create(
            sync_run_id=sync_run_id,
            channel_revision=revision,
            provider=self._channel.provider,
            started_by_account_id=started_by_account_id,
            now=now,
        )
        record = sync_run_to_record(run)
        self._session.add(record)
        self._session.flush([record])
        return ActiveRunDecision(ActiveRunDecisionKind.CREATED, sync_run_from_record(record))

    def finish_stale_run(self, sync_run_id: IMSyncRunId, *, now: NaiveDatetime) -> IMSyncRun | None:
        """Finish this Channel's older capture under Channel-then-run locks.

        Return None when the Channel snapshot is no longer current or the run
        does not belong to an older revision of it. The caller owns the transaction.
        Terminal runs are returned without appending another diagnostic.
        """
        if not self._serialize_current_channel():
            return None
        record = self._session.scalar(
            sa.select(HumanInputIMSyncRun)
            .where(
                HumanInputIMSyncRun.id == str(sync_run_id),
                HumanInputIMSyncRun.channel_id == str(self._channel.id),
                HumanInputIMSyncRun.channel_config_version < self._channel.config_version,
            )
            .with_for_update()
        )
        if record is None:
            return None
        if record.status in (IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING):
            self._finish_stale_run(record, now)
        return sync_run_from_record(record)

    def _finish_stale_run(self, record: HumanInputIMSyncRun, now: NaiveDatetime) -> None:
        """The caller holds both row locks; never modify current directory state."""
        code = "stale_revision"
        message = "IM Channel revision changed before reconciliation apply."
        diagnostic = SyncResultFact(
            id=IMSyncResultId(str(uuidv7())),
            channel_id=IMChannelId(record.channel_id),
            sync_run_id=IMSyncRunId(record.id),
            operation_key=f"diagnostic:{code}",
            result_type=IMSyncResultType.FAILED,
            provider_user_id=None,
            display_name=None,
            email=None,
            normalized_email=None,
            contact_id=None,
            identity_id=None,
            binding_id=None,
            removal_reason=None,
            reason_code=code,
            reason_message=message,
            directory_entry_payload=None,
            contact_snapshot=None,
            identity_snapshot=None,
            created_at=now,
            updated_at=now,
        )
        self._session.add(sync_result_to_record(diagnostic))
        record.status = IMSyncRunStatus.FAILED
        record.failed_count = 1
        record.started_at = record.started_at or now
        record.finished_at = now
        record.error_code = code
        record.error_message = message
        record.updated_at = now
        self._session.flush()

    def _serialize_current_channel(self) -> bool:
        """Acquire the current Channel row's database write lock portably."""

        result = self._session.execute(
            sa.update(HumanInputIMChannel)
            .where(
                HumanInputIMChannel.id == str(self._channel.id),
                HumanInputIMChannel.config_version == self._channel.config_version,
                HumanInputIMChannel.provider == self._channel.provider,
            )
            .values({HumanInputIMChannel.updated_at: HumanInputIMChannel.updated_at})
            .execution_options(autoflush=False, synchronize_session=False)
        )
        if not isinstance(result, CursorResult):
            raise TypeError("conditional IM Channel guard did not return a cursor result")
        return result.rowcount == 1

    def load_sync_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None:
        record = self._session.get(HumanInputIMSyncRun, str(sync_run_id))
        return sync_run_from_record(record) if record is not None else None

    def load_latest_sync_run(self) -> IMSyncRun | None:
        record = self._session.scalar(
            sa.select(HumanInputIMSyncRun)
            .where(HumanInputIMSyncRun.channel_id == str(self._channel.id))
            .order_by(HumanInputIMSyncRun.created_at.desc(), HumanInputIMSyncRun.id.desc())
            .limit(1)
        )
        return sync_run_from_record(record) if record is not None else None

    def page_sync_results(
        self,
        sync_run_id: IMSyncRunId,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1 or limit > _MAX_PAGE_LIMIT:
            raise ValueError(f"limit must be between 1 and {_MAX_PAGE_LIMIT}")
        predicate = (
            HumanInputIMSyncResult.sync_run_id == str(sync_run_id),
            HumanInputIMSyncResult.result_type == result_type,
        )
        total = self._session.scalar(sa.select(sa.func.count(HumanInputIMSyncResult.id)).where(*predicate)) or 0
        records = self._session.scalars(
            sa.select(HumanInputIMSyncResult)
            .where(*predicate)
            .order_by(HumanInputIMSyncResult.created_at, HumanInputIMSyncResult.id)
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()
        return SyncResultPage(
            tuple(sync_result_from_record(record) for record in records),
            page=page,
            limit=limit,
            total=total,
        )

    def search_identities(
        self,
        identities: IMIdentityRepository,
        bindings: IMBindingRepository,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> SynchronizedIMIdentityPage:
        identity_page = identities.search(keyword=keyword or "", page=page, limit=limit)
        bound_identity_ids = {binding.identity_id for binding in bindings.list_all()}
        return SynchronizedIMIdentityPage(
            items=tuple(
                SynchronizedIMIdentity(
                    id=identity.id,
                    provider=self._channel.provider,
                    provider_user_id=identity.provider_user_id,
                    display_name=identity.display_name,
                    email=identity.email,
                    binding_status=(
                        IMIdentityBindingStatus.BOUND
                        if identity.id in bound_identity_ids
                        else IMIdentityBindingStatus.UNBOUND
                    ),
                )
                for identity in identity_page.items
            ),
            page=identity_page.page,
            limit=identity_page.limit,
            total=identity_page.total,
        )

    def append_sync_results(self, results: tuple[SyncResultFact, ...]) -> None:
        for result in results:
            self._session.add(sync_result_to_record(result))
        self._session.flush()


__all__ = ["SQLAlchemyIMControlPlaneRepository"]
