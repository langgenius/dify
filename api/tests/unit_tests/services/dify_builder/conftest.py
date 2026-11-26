"""SQL repository shared by the Builder service tests."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from services.dify_builder.repository import SqlDifyBuilderRepository


@pytest.fixture
def repo(sqlite_session_factory: sessionmaker[Session]) -> SqlDifyBuilderRepository:
    return SqlDifyBuilderRepository(sqlite_session_factory)
