from sqlalchemy.orm import DeclarativeBase

from models.engine import metadata


class Base(DeclarativeBase):
    metadata = metadata
