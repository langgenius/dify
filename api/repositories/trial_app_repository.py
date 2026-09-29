"""Query trial app eligibility and record account usage in independent sessions."""

from collections.abc import Sequence, Set
from typing import override

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, sessionmaker

from models.model import AccountTrialAppRecord, App, TrialApp
from services.recommended_app_query_service import TrialAppQuery
from services.trial_app_access_service import TrialAppAccessQuery, TrialAppAccessSnapshot, TrialAppRef
from services.trial_app_usage import TrialAppUsageRecorder


class TrialAppRepository(TrialAppQuery, TrialAppAccessQuery, TrialAppUsageRecorder):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def existing_ids(self, app_ids: Sequence[str]) -> Set[str]:
        if not app_ids:
            return frozenset()

        with self._session_factory() as session:
            return frozenset(session.scalars(select(TrialApp.app_id).where(TrialApp.app_id.in_(app_ids))).all())

    @override
    def resolve(self, *, app_id: str, account_id: str) -> TrialAppAccessSnapshot | None:
        with self._session_factory() as session:
            row = session.execute(
                select(App.id, App.tenant_id, App.mode, TrialApp.trial_limit, AccountTrialAppRecord.count)
                .select_from(TrialApp)
                .join(App, App.id == TrialApp.app_id)
                .outerjoin(
                    AccountTrialAppRecord,
                    and_(
                        AccountTrialAppRecord.app_id == App.id,
                        AccountTrialAppRecord.account_id == account_id,
                    ),
                )
                .where(TrialApp.app_id == app_id)
            ).one_or_none()
            if row is None:
                return None

            resolved_app_id, tenant_id, app_mode, trial_limit, used_count = row
            return TrialAppAccessSnapshot(
                app=TrialAppRef(app_id=resolved_app_id, tenant_id=tenant_id, app_mode=app_mode),
                trial_limit=trial_limit,
                used_count=used_count,
            )

    @override
    def record(self, *, app_id: str, account_id: str) -> None:
        """Increment usage without committing the caller's request transaction."""
        with self._session_factory() as session, session.begin():
            record = session.scalar(
                select(AccountTrialAppRecord)
                .where(AccountTrialAppRecord.app_id == app_id, AccountTrialAppRecord.account_id == account_id)
                .limit(1)
            )
            if record is None:
                session.add(AccountTrialAppRecord(app_id=app_id, account_id=account_id, count=1))
            else:
                record.count += 1
