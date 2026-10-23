from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from tests.helpers.end_user_connection_contract import ConnectionPersistenceTests


@pytest.fixture
def connection_session() -> Iterator[Session]:
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        EndUserConnection.metadata.create_all(
            connection,
            tables=[
                model.metadata.tables[model.__tablename__]
                for model in (EndUserConnection, AppConnection, SessionConnection)
            ],
        )
        connection.commit()
        with Session(connection) as session:
            yield session
    engine.dispose()


class TestEndUserConnection(ConnectionPersistenceTests):
    pass
