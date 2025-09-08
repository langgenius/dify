from sqlalchemy.orm import DeclarativeBase, MappedAsDataclass

from models.engine import metadata


class Base(DeclarativeBase):
    metadata = metadata


class TypeBase(MappedAsDataclass, DeclarativeBase):
    """
    This is for adding type, after all finished, rename to Base.
    """

    metadata = metadata
