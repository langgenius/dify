from datetime import datetime

import sqlalchemy as sa
from celery import states
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from models.base import TypeBase


class CeleryTask(TypeBase):
    """Task result/status."""

    __tablename__ = "celery_taskmeta"

    id: Mapped[int] = mapped_column(
        sa.Integer, sa.Sequence("task_id_sequence"), primary_key=True, autoincrement=True, init=False
    )
    task_id: Mapped[str] = mapped_column(String(155), unique=True)
    status: Mapped[str] = mapped_column(String(50), default=states.PENDING)
    result: Mapped[bytes | None] = mapped_column(sa.PickleType, nullable=True, default=None)
    date_done: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=naive_utc_now,
        onupdate=naive_utc_now,
        nullable=True,
    )
    traceback: Mapped[str | None] = mapped_column(sa.Text, nullable=True, default=None)
    name: Mapped[str | None] = mapped_column(String(155), nullable=True, default=None)
    args: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True, default=None)
    kwargs: Mapped[bytes | None] = mapped_column(sa.LargeBinary, nullable=True, default=None)
    worker: Mapped[str | None] = mapped_column(String(155), nullable=True, default=None)
    retries: Mapped[int | None] = mapped_column(sa.Integer, nullable=True, default=None)
    queue: Mapped[str | None] = mapped_column(String(155), nullable=True, default=None)


class CeleryTaskSet(TypeBase):
    """TaskSet result."""

    __tablename__ = "celery_tasksetmeta"

    id: Mapped[int] = mapped_column(
        sa.Integer, sa.Sequence("taskset_id_sequence"), autoincrement=True, primary_key=True, init=False
    )
    taskset_id: Mapped[str] = mapped_column(String(155), unique=True)
    result: Mapped[bytes | None] = mapped_column(sa.PickleType, nullable=True, default=None)
    date_done: Mapped[datetime | None] = mapped_column(DateTime, default=naive_utc_now, nullable=True)
