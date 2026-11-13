"""Persistence operations for durable post-commit App deletion delivery."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import sqlalchemy as sa
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from models.app_deletion_outbox import AppDeletionOutbox, AppDeletionOutboxStatus
from services.entities.app_entities import AppDeletion, AppEvent


@dataclass(frozen=True, slots=True)
class AppDeletionOutboxWorkItem:
    outbox_id: str
    tenant_id: str
    app_id: str
    account_id: str | None
    deletion: AppDeletion
    attempt_count: int


class AppDeletionOutboxRepository:
    """Use caller-owned transactions for enqueue, claim, retry, and completion."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, *, deletion: AppDeletion, account_id: str | None) -> AppDeletionOutbox:
        """Persist the complete cleanup intent in the App deletion transaction."""
        payload = _encode_deletion(deletion)
        row = AppDeletionOutbox(
            tenant_id=deletion.app.tenant_id,
            app_id=deletion.app.id,
            account_id=account_id,
            deletion_payload=payload,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def claim_ready(
        self,
        *,
        now: datetime,
        lease_owner: str,
        lease_duration: timedelta,
        limit: int,
    ) -> list[AppDeletionOutboxWorkItem]:
        """Lease ready or expired rows and return detached work items."""
        if not lease_owner.strip():
            raise ValueError("lease_owner must not be blank")
        if lease_duration <= timedelta(0):
            raise ValueError("lease_duration must be positive")
        if limit < 1:
            raise ValueError("limit must be positive")

        ready = sa.and_(
            AppDeletionOutbox.status.in_((AppDeletionOutboxStatus.PENDING, AppDeletionOutboxStatus.RETRY)),
            sa.or_(AppDeletionOutbox.next_attempt_at.is_(None), AppDeletionOutbox.next_attempt_at <= now),
        )
        expired = sa.and_(
            AppDeletionOutbox.status == AppDeletionOutboxStatus.PROCESSING,
            AppDeletionOutbox.lease_expires_at <= now,
        )
        rows = self._session.scalars(
            select(AppDeletionOutbox)
            .where(sa.or_(ready, expired))
            .order_by(AppDeletionOutbox.created_at, AppDeletionOutbox.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        ).all()
        work: list[AppDeletionOutboxWorkItem] = []
        for row in rows:
            row.status = AppDeletionOutboxStatus.PROCESSING
            row.lease_owner = lease_owner
            row.lease_expires_at = now + lease_duration
            row.attempt_count += 1
            row.last_attempt_at = now
            work.append(
                AppDeletionOutboxWorkItem(
                    outbox_id=row.id,
                    tenant_id=row.tenant_id,
                    app_id=row.app_id,
                    account_id=row.account_id,
                    deletion=_decode_deletion(row.deletion_payload),
                    attempt_count=row.attempt_count,
                )
            )
        self._session.flush()
        return work

    def mark_succeeded(self, *, outbox_id: str, lease_owner: str, completed_at: datetime) -> bool:
        statement = (
            update(AppDeletionOutbox)
            .where(
                AppDeletionOutbox.id == outbox_id,
                AppDeletionOutbox.status == AppDeletionOutboxStatus.PROCESSING,
                AppDeletionOutbox.lease_owner == lease_owner,
            )
            .values(
                status=AppDeletionOutboxStatus.SUCCEEDED,
                lease_owner=None,
                lease_expires_at=None,
                completed_at=completed_at,
                next_attempt_at=None,
                last_error_message=None,
            )
            .execution_options(synchronize_session=False)
        )
        return _updated_once(self._session, statement)

    def schedule_retry(
        self,
        *,
        outbox_id: str,
        lease_owner: str,
        next_attempt_at: datetime,
        error_message: str,
    ) -> bool:
        statement = (
            update(AppDeletionOutbox)
            .where(
                AppDeletionOutbox.id == outbox_id,
                AppDeletionOutbox.status == AppDeletionOutboxStatus.PROCESSING,
                AppDeletionOutbox.lease_owner == lease_owner,
            )
            .values(
                status=AppDeletionOutboxStatus.RETRY,
                lease_owner=None,
                lease_expires_at=None,
                next_attempt_at=next_attempt_at,
                last_error_message=error_message,
            )
            .execution_options(synchronize_session=False)
        )
        return _updated_once(self._session, statement)

    def delete_succeeded_before(self, *, completed_before: datetime, limit: int) -> int:
        expired = self._session.scalars(
            select(AppDeletionOutbox)
            .where(
                AppDeletionOutbox.status == AppDeletionOutboxStatus.SUCCEEDED,
                AppDeletionOutbox.completed_at < completed_before,
            )
            .order_by(AppDeletionOutbox.completed_at, AppDeletionOutbox.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        ).all()
        for row in expired:
            self._session.delete(row)
        self._session.flush()
        return len(expired)


def _encode_deletion(deletion: AppDeletion) -> dict[str, object]:
    return {
        "app": {"id": deletion.app.id, "tenant_id": deletion.app.tenant_id, "mode": deletion.app.mode},
        "workflow_agent_ids": sorted(deletion.workflow_agent_ids),
        "workspace_ids": list(deletion.workspace_ids),
        "binding_ids": list(deletion.binding_ids),
        "home_snapshot_ids": list(deletion.home_snapshot_ids),
        "backing_agent_id": deletion.backing_agent_id,
    }


def _decode_deletion(payload: dict[str, object]) -> AppDeletion:
    app_payload = _require_object(payload.get("app"), field="app")
    app_id = _require_string(app_payload.get("id"), field="app.id")
    tenant_id = _require_string(app_payload.get("tenant_id"), field="app.tenant_id")
    mode = _require_string(app_payload.get("mode"), field="app.mode")
    workflow_agent_ids = _require_string_list(payload.get("workflow_agent_ids"), field="workflow_agent_ids")
    workspace_ids = _require_string_list(payload.get("workspace_ids"), field="workspace_ids")
    binding_ids = _require_string_list(payload.get("binding_ids"), field="binding_ids")
    home_snapshot_ids = _require_string_list(payload.get("home_snapshot_ids"), field="home_snapshot_ids")
    raw_backing_agent_id = payload.get("backing_agent_id")
    if raw_backing_agent_id is not None and not isinstance(raw_backing_agent_id, str):
        raise ValueError("Invalid App deletion outbox field: backing_agent_id")
    return AppDeletion(
        app=AppEvent(id=app_id, tenant_id=tenant_id, mode=mode),
        workflow_agent_ids=set(workflow_agent_ids),
        workspace_ids=workspace_ids,
        binding_ids=binding_ids,
        home_snapshot_ids=home_snapshot_ids,
        backing_agent_id=raw_backing_agent_id,
    )


def _require_object(value: object, *, field: str) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ValueError(f"Invalid App deletion outbox field: {field}")
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _require_string(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"Invalid App deletion outbox field: {field}")
    return value


def _require_string_list(value: object, *, field: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"Invalid App deletion outbox field: {field}")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"Invalid App deletion outbox field: {field}")
        result.append(item)
    return result


def _updated_once(session: Session, statement: sa.Update) -> bool:
    result = session.execute(statement)
    return result.rowcount == 1


__all__ = ["AppDeletionOutboxRepository", "AppDeletionOutboxWorkItem"]
