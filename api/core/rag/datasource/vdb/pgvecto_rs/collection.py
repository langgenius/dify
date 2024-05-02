from uuid import UUID

from numpy import ndarray
from sqlalchemy.orm import DeclarativeBase, Mapped


class CollectionORM(DeclarativeBase):
    __tablename__: str
    id: Mapped[UUID]
    text: Mapped[str]
    meta: Mapped[dict]
    vector: Mapped[ndarray]
