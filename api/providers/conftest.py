"""Shared database fixtures for provider tests.

Provider tests live outside ``tests/unit_tests`` and therefore cannot use that
suite's SQLite fixtures. Keep this fixture scoped to ``providers`` so each
provider package can exercise real SQLAlchemy queries without a service
database or mocked sessions.
"""

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from models.base import TypeBase


@pytest.fixture
def sqlite3_session(request: pytest.FixtureRequest) -> Iterator[Session]:
    """Yield an isolated SQLite session with the parametrized model tables.

    Pass the required ORM classes through indirect parametrization. The engine
    is per-test so committed rows and identity-map state cannot leak between
    provider packages.
    """

    models: tuple[type[TypeBase], ...] = request.param
    engine = create_engine("sqlite:///:memory:")
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(engine, tables=tables)
    try:
        with Session(engine, expire_on_commit=False) as session:
            yield session
    finally:
        engine.dispose()
