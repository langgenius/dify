import datetime
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

import sqlalchemy as sa
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, Message
from services.retention.conversation.messages_clean_policy import (
    EligibleAppMessagesCleanPolicy,
    SimpleMessage,
)


@dataclass
class AppCursorState:
    app_id: str
    tenant_id: str
    cursor: tuple[datetime.datetime, str] | None = None


@dataclass
class EligibleAppScanBatch:
    messages: list[SimpleMessage]
    app_to_tenant: dict[str, str]
    app_fetches: int
    exhausted_apps: int


class EligibleAppRoundRobinScanner:
    """
    Scans messages only for apps whose tenants are eligible for sandbox cleanup.

    App discovery walks the App table in stable id order and asks the policy to filter eligible tenants.
    Message scanning then uses a per-app (created_at, id) cursor and puts non-exhausted apps back at the
    end of the queue, so a single large eligible app cannot monopolize the whole job.
    """

    _policy: EligibleAppMessagesCleanPolicy
    _start_from: datetime.datetime | None
    _end_before: datetime.datetime
    _app_page_size: int
    _per_app_batch_size: int
    _app_queue: deque[AppCursorState]
    _last_seen_app_id: str | None
    _app_pages_exhausted: bool
    scanned_apps: int
    eligible_apps: int
    empty_apps: int

    def __init__(
        self,
        *,
        policy: EligibleAppMessagesCleanPolicy,
        start_from: datetime.datetime | None,
        end_before: datetime.datetime,
        app_page_size: int,
        per_app_batch_size: int,
    ) -> None:
        self._policy = policy
        self._start_from = start_from
        self._end_before = end_before
        self._app_page_size = app_page_size
        self._per_app_batch_size = per_app_batch_size
        self._app_queue = deque()
        self._last_seen_app_id = None
        self._app_pages_exhausted = False
        self.scanned_apps = 0
        self.eligible_apps = 0
        self.empty_apps = 0

    def fetch_batch(
        self,
        session_factory: sessionmaker[Session],
        *,
        target_message_count: int,
    ) -> EligibleAppScanBatch:
        messages: list[SimpleMessage] = []
        app_to_tenant: dict[str, str] = {}
        app_fetches = 0
        exhausted_apps = 0

        while len(messages) < target_message_count and self._ensure_app_queue(session_factory):
            app_state = self._app_queue.popleft()
            fetch_limit = min(self._per_app_batch_size, target_message_count - len(messages))
            with session_factory() as session:
                fetched_messages = self._fetch_messages_for_app(session, app_state, limit=fetch_limit)
            app_fetches += 1

            if not fetched_messages:
                exhausted_apps += 1
                self.empty_apps += 1
                continue

            messages.extend(fetched_messages)
            app_to_tenant[app_state.app_id] = app_state.tenant_id
            app_state.cursor = (fetched_messages[-1].created_at, fetched_messages[-1].id)

            if len(fetched_messages) == fetch_limit:
                self._app_queue.append(app_state)
            else:
                exhausted_apps += 1

        return EligibleAppScanBatch(
            messages=messages,
            app_to_tenant=app_to_tenant,
            app_fetches=app_fetches,
            exhausted_apps=exhausted_apps,
        )

    def _ensure_app_queue(self, session_factory: sessionmaker[Session]) -> bool:
        while not self._app_queue and not self._app_pages_exhausted:
            rows = self._fetch_next_app_page(session_factory)
            if rows:
                self._enqueue_eligible_apps(rows)
        return bool(self._app_queue)

    def _fetch_next_app_page(self, session_factory: sessionmaker[Session]) -> list[tuple[str, str]]:
        app_stmt = select(App.id, App.tenant_id).order_by(App.id).limit(self._app_page_size)
        if self._last_seen_app_id is not None:
            app_stmt = app_stmt.where(App.id > self._last_seen_app_id)

        with session_factory() as session:
            rows = cast(list[tuple[str, str]], list(session.execute(app_stmt).all()))

        if not rows:
            self._app_pages_exhausted = True
            return []

        self._last_seen_app_id = rows[-1][0]
        self.scanned_apps += len(rows)
        return rows

    def _enqueue_eligible_apps(self, rows: Sequence[tuple[str, str]]) -> None:
        app_to_tenant: dict[str, str] = dict(rows)
        eligible_app_to_tenant = self._policy.filter_app_to_tenant(app_to_tenant)
        self.eligible_apps += len(eligible_app_to_tenant)

        for app_id, tenant_id in rows:
            if eligible_app_to_tenant.get(app_id) == tenant_id:
                self._app_queue.append(AppCursorState(app_id=app_id, tenant_id=tenant_id))

    def _fetch_messages_for_app(
        self,
        session: Session,
        app_state: AppCursorState,
        *,
        limit: int,
    ) -> list[SimpleMessage]:
        msg_stmt = (
            select(Message.id, Message.app_id, Message.created_at)
            .where(
                Message.app_id == app_state.app_id,
                Message.created_at < self._end_before,
            )
            .order_by(Message.created_at, Message.id)
            .limit(limit)
        )

        if self._start_from:
            msg_stmt = msg_stmt.where(Message.created_at >= self._start_from)

        if app_state.cursor:
            msg_stmt = msg_stmt.where(
                tuple_(Message.created_at, Message.id)
                > tuple_(
                    sa.literal(app_state.cursor[0], type_=sa.DateTime()),
                    sa.literal(app_state.cursor[1], type_=Message.id.type),
                )
            )

        rows = cast(Sequence[tuple[str, str, datetime.datetime]], session.execute(msg_stmt).all())
        return self._rows_to_simple_messages(rows)

    @staticmethod
    def _rows_to_simple_messages(rows: Sequence[tuple[str, str, datetime.datetime]]) -> list[SimpleMessage]:
        return [SimpleMessage(id=msg_id, app_id=app_id, created_at=created_at) for msg_id, app_id, created_at in rows]
