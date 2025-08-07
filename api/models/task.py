from datetime import datetime
from typing import Any, Optional

import sqlalchemy as sa
from celery import states  # type: ignore
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from models.base import Base


class CeleryTask(Base):
    """Task result/status."""

    __tablename__ = "celery_taskmeta"

    id: Mapped[int] = mapped_column(sa.Integer, sa.Sequence("task_id_sequence"), primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(155), unique=True)
    status: Mapped[str] = mapped_column(String(50), default=states.PENDING)
    result: Mapped[Optional[Any]] = mapped_column(sa.PickleType, nullable=True)
    date_done: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        default=lambda: naive_utc_now(),
        onupdate=lambda: naive_utc_now(),
        nullable=True,
    )
    traceback: Mapped[Optional[str]] = mapped_column(sa.Text, nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(155), nullable=True)
    args: Mapped[Optional[bytes]] = mapped_column(sa.LargeBinary, nullable=True)
    kwargs: Mapped[Optional[bytes]] = mapped_column(sa.LargeBinary, nullable=True)
    worker: Mapped[Optional[str]] = mapped_column(String(155), nullable=True)
    retries: Mapped[Optional[int]] = mapped_column(sa.Integer, nullable=True)
    queue: Mapped[Optional[str]] = mapped_column(String(155), nullable=True)


class CeleryTaskSet(Base):
    """TaskSet result."""

    __tablename__ = "celery_tasksetmeta"

    id: Mapped[int] = mapped_column(
        sa.Integer, sa.Sequence("taskset_id_sequence"), autoincrement=True, primary_key=True
    )
    taskset_id: Mapped[str] = mapped_column(String(155), unique=True)
    result: Mapped[Optional[Any]] = mapped_column(sa.PickleType, nullable=True)
    date_done: Mapped[Optional[datetime]] = mapped_column(DateTime, default=lambda: naive_utc_now(), nullable=True)
