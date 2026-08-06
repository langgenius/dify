"""Database repository for recommended app trial eligibility."""

from collections.abc import Sequence, Set
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.model import TrialApp
from services.recommended_app_query_service import TrialAppQuery


class TrialAppQueryRepository(TrialAppQuery):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def existing_ids(self, app_ids: Sequence[str]) -> Set[str]:
        if not app_ids:
            return frozenset()

        with self._session_factory() as session:
            return frozenset(session.scalars(select(TrialApp.app_id).where(TrialApp.app_id.in_(app_ids))).all())
