from datetime import UTC, datetime

from celery import states  # type: ignore

from .engine import db


class CeleryTask(db.Model):  # type: ignore[name-defined]
    """Task result/status."""

    __tablename__ = "celery_taskmeta"

    id = db.Column(db.Integer, db.Sequence("task_id_sequence"), primary_key=True, autoincrement=True)
    task_id = db.Column(db.String(155), unique=True)
    status = db.Column(db.String(50), default=states.PENDING)
    result = db.Column(db.PickleType, nullable=True)
    date_done = db.Column(
        db.DateTime,
        default=lambda: datetime.now(UTC).replace(tzinfo=None),
        onupdate=lambda: datetime.now(UTC).replace(tzinfo=None),
        nullable=True,
    )
    traceback = db.Column(db.Text, nullable=True)
    name = db.Column(db.String(155), nullable=True)
    args = db.Column(db.LargeBinary, nullable=True)
    kwargs = db.Column(db.LargeBinary, nullable=True)
    worker = db.Column(db.String(155), nullable=True)
    retries = db.Column(db.Integer, nullable=True)
    queue = db.Column(db.String(155), nullable=True)


class CeleryTaskSet(db.Model):  # type: ignore[name-defined]
    """TaskSet result."""

    __tablename__ = "celery_tasksetmeta"

    id = db.Column(db.Integer, db.Sequence("taskset_id_sequence"), autoincrement=True, primary_key=True)
    taskset_id = db.Column(db.String(155), unique=True)
    result = db.Column(db.PickleType, nullable=True)
    date_done = db.Column(db.DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None), nullable=True)
