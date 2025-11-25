from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, MappedAsDataclass, mapped_column

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .engine import metadata
from .types import StringUUID


class Base(DeclarativeBase):
    metadata = metadata


class TypeBase(MappedAsDataclass, DeclarativeBase):
    """
    This is for adding type, after all finished, rename to Base.
    """

    metadata = metadata


class DefaultFieldsMixin:
    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        # NOTE: The default serve as fallback mechanisms.
        # The application can generate the `id` before saving to optimize
        # the insertion process (especially for interdependent models)
        # and reduce database roundtrips.
        default=lambda: str(uuidv7()),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=naive_utc_now,
        server_default=func.current_timestamp(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        __name_pos=DateTime,
        nullable=False,
        default=naive_utc_now,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(id={self.id})>"
