from typing import Protocol, cast

from sqlalchemy import ColumnElement, CursorResult, delete, select
from sqlalchemy.orm import Mapped, Session

DELETE_BATCH_SIZE = 500


class _HasId(Protocol):
    id: Mapped[str]


def delete_in_batches(
    session: Session, model: type[_HasId], candidates: ColumnElement[bool], *, batch_size: int = DELETE_BATCH_SIZE
) -> int:
    """The DELETE re-checks ``candidates`` so a row that stopped matching after the SELECT is kept."""
    total = 0
    while True:
        ids = session.scalars(select(model.id).where(candidates).limit(batch_size)).all()
        if not ids:
            return total
        result = cast(CursorResult, session.execute(delete(model).where(model.id.in_(ids), candidates)))
        session.commit()
        total += result.rowcount
