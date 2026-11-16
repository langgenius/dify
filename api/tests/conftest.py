import gc
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

from core.app.workflow.file_runtime import create_dify_workflow_file_runtime
from graphon.file.runtime import use_workflow_file_runtime
from models.base import TypeBase

# Tests select an explicit deployment event transport.
os.environ.setdefault("HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE", "WEBHOOK")


@pytest.fixture(scope="session")
def _sqlite_database_template(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Build one empty full-schema SQLite file per worker after test collection.

    Callers must copy the returned file before opening it for writes. Dispose
    the construction engine on success or failure so committed rows and DDL in
    individual test databases cannot change the pristine template.
    """
    database_path = tmp_path_factory.mktemp("sqlite-template") / "unit-tests.sqlite3"
    engine = create_engine(URL.create("sqlite", database=str(database_path)))
    try:
        TypeBase.metadata.create_all(engine)
    finally:
        engine.dispose()
    return database_path


def pytest_collection_finish(session: pytest.Session) -> None:
    """Move everything loaded during collection out of the garbage collector's reach.

    Collection imports the whole application, so every automatic full collection afterwards
    rescanned those long-lived objects and stalled whichever test triggered it. Objects created
    by tests themselves are still collected normally.
    """
    gc.collect()
    gc.freeze()


@pytest.fixture(autouse=True)
def _bind_workflow_file_runtime() -> Iterator[None]:
    with use_workflow_file_runtime(create_dify_workflow_file_runtime()):
        yield
