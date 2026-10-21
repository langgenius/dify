"""Bind actual SQLAlchemy sessions to owners without replacing their database operations."""

from dataclasses import dataclass

from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, scoped_session


@dataclass(frozen=True)
class BoundDatabase:
    session: Session | scoped_session[Session]

    @property
    def engine(self) -> Engine | Connection:
        return self.session.get_bind()
