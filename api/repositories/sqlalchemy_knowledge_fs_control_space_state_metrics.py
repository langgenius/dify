"""Database aggregation for low-cardinality KnowledgeFS current-state metrics."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState


class SQLAlchemyKnowledgeFSControlSpaceStateCountReader:
    """Read global operational counts without exposing tenant or resource labels."""

    _states = (
        KnowledgeFSControlSpaceState.PROVISIONING,
        KnowledgeFSControlSpaceState.DELETING,
        KnowledgeFSControlSpaceState.ERROR,
    )

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def __call__(self) -> dict[str, int]:
        statement = (
            select(KnowledgeFSControlSpace.state, func.count())
            .where(KnowledgeFSControlSpace.state.in_(self._states))
            .group_by(KnowledgeFSControlSpace.state)
        )
        with self._session_maker() as session:
            rows = session.execute(statement).all()
        counts = {state.value: 0 for state in self._states}
        counts.update({state.value: int(count) for state, count in rows})
        return counts


__all__ = ["SQLAlchemyKnowledgeFSControlSpaceStateCountReader"]
