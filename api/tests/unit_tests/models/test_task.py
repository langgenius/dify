from collections.abc import Generator
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.task import CeleryTask, CeleryTaskSet


@pytest.fixture
def task_engine(_unit_test_engine: Engine) -> Generator[Engine]:
    for model in (CeleryTask, CeleryTaskSet):
        model.__table__.create(bind=_unit_test_engine, checkfirst=True)
    yield _unit_test_engine
    for model in (CeleryTaskSet, CeleryTask):
        model.__table__.drop(bind=_unit_test_engine, checkfirst=True)


@pytest.mark.parametrize(
    ("model", "id_kwarg"),
    [
        pytest.param(CeleryTask, "task_id", id="celery_task"),
        pytest.param(CeleryTaskSet, "taskset_id", id="celery_task_set"),
    ],
)
class TestDateDone:
    def test_constructor_omitted_date_done_defaults_to_none(
        self, model: type[CeleryTask | CeleryTaskSet], id_kwarg: str
    ) -> None:
        kwargs: dict[str, str] = {id_kwarg: "id-1"}
        instance = model(**kwargs)
        assert instance.date_done is None

    def test_constructor_explicit_date_done(self, model: type[CeleryTask | CeleryTaskSet], id_kwarg: str) -> None:
        explicit = datetime(2024, 1, 2, 3, 4, 5)
        kwargs: dict[str, str] = {id_kwarg: "id-2"}
        instance = model(**kwargs, date_done=explicit)
        assert instance.date_done == explicit

    def test_flush_generates_naive_utc_timestamp(
        self, task_engine: Engine, model: type[CeleryTask | CeleryTaskSet], id_kwarg: str
    ) -> None:
        before = naive_utc_now()
        kwargs: dict[str, str] = {id_kwarg: "id-3"}
        with Session(task_engine) as session:
            instance = model(**kwargs)
            session.add(instance)
            session.flush()
            after = naive_utc_now()
            assert instance.date_done is not None
            assert before <= instance.date_done <= after

    def test_explicit_date_done_survives_persistence(
        self, task_engine: Engine, model: type[CeleryTask | CeleryTaskSet], id_kwarg: str
    ) -> None:
        explicit = datetime(2020, 6, 15, 12, 30, 0)
        id_value = "id-4"
        kwargs: dict[str, str] = {id_kwarg: id_value}
        with Session(task_engine) as session:
            session.add(model(**kwargs, date_done=explicit))
            session.commit()

        with Session(task_engine) as session:
            stmt = select(model).where(getattr(model, id_kwarg) == id_value)
            persisted = session.execute(stmt).scalar_one()
            assert persisted.date_done == explicit

    def test_core_insert_generates_timestamp(
        self, task_engine: Engine, model: type[CeleryTask | CeleryTaskSet], id_kwarg: str
    ) -> None:
        table = model.__table__
        before = naive_utc_now()
        with task_engine.connect() as conn:
            conn.execute(table.insert().values(**{id_kwarg: "id-5"}))
            row = conn.execute(select(table.c.date_done)).scalar_one()
        after = naive_utc_now()
        assert row is not None
        assert before <= row <= after


def test_celery_task_onupdate_refreshes_date_done(task_engine: Engine) -> None:
    old = datetime(2000, 1, 1)
    with Session(task_engine) as session:
        task = CeleryTask(task_id="onupdate-task", status="PENDING", date_done=old)
        session.add(task)
        session.flush()
        task.status = "SUCCESS"
        session.flush()
        assert task.date_done is not None
        assert task.date_done > old


def test_celery_task_set_has_no_onupdate() -> None:
    assert CeleryTaskSet.__table__.c.date_done.onupdate is None
    assert CeleryTask.__table__.c.date_done.onupdate is not None
