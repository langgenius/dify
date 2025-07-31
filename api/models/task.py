from datetime import datetime
from typing import Optional

from celery import states  # type: ignore
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now
from models.base import Base

from .engine import db


class CeleryTask(Base):
    """Task result/status."""

    __tablename__ = "celery_taskmeta"

    id = mapped_column(db.Integer, db.Sequence("task_id_sequence"), primary_key=True, autoincrement=True)
    task_id = mapped_column(String(155), unique=True)
    status = mapped_column(String(50), default=states.PENDING)
    result = mapped_column(db.PickleType, nullable=True)
    date_done = mapped_column(
        DateTime,
        default=lambda: naive_utc_now(),
        onupdate=lambda: naive_utc_now(),
        nullable=True,
    )
    traceback = mapped_column(db.Text, nullable=True)
    name = mapped_column(String(155), nullable=True)
    args = mapped_column(db.LargeBinary, nullable=True)
    kwargs = mapped_column(db.LargeBinary, nullable=True)
    worker = mapped_column(String(155), nullable=True)
    retries: Mapped[Optional[int]] = mapped_column(db.Integer, nullable=True)
    queue = mapped_column(String(155), nullable=True)


class CeleryTaskSet(Base):
    """TaskSet result."""

    __tablename__ = "celery_tasksetmeta"

    id: Mapped[int] = mapped_column(
        db.Integer, db.Sequence("taskset_id_sequence"), autoincrement=True, primary_key=True
    )
    taskset_id = mapped_column(String(155), unique=True)
    result = mapped_column(db.PickleType, nullable=True)
    date_done: Mapped[Optional[datetime]] = mapped_column(DateTime, default=lambda: naive_utc_now(), nullable=True)
