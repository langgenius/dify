"""Run the persistence contract against PostgreSQL in CI only."""

import pytest
from sqlalchemy.orm import Session

from tests.helpers.end_user_connection_contract import ConnectionPersistenceTests


@pytest.fixture
def connection_session(db_session_with_containers: Session) -> Session:
    return db_session_with_containers


class TestEndUserConnection(ConnectionPersistenceTests):
    pass
