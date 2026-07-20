from __future__ import annotations

from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from extensions import ext_redis
from extensions.ext_database import db
from models.account import Account

ACCOUNT_EMAIL = f"container-state-isolation-{uuid4()}@example.com"
REDIS_KEY = f"container-state-isolation:{uuid4()}"


@pytest.mark.requires_redis
def test_1_container_state_can_be_written(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    account = Account(
        name="Container State Isolation",
        email=ACCOUNT_EMAIL,
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )
    db_session_with_containers.add(account)
    db_session_with_containers.commit()

    with flask_app_with_containers.app_context():
        ext_redis.redis_client.set(REDIS_KEY, "leaked")
        assert ext_redis.redis_client.get(REDIS_KEY) == b"leaked"


@pytest.mark.requires_redis
def test_2_container_state_is_flushed_between_tests(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    assert db_session_with_containers.query(Account).filter_by(email=ACCOUNT_EMAIL).one_or_none() is None

    with flask_app_with_containers.app_context():
        assert ext_redis.redis_client.get(REDIS_KEY) is None


def test_3_database_app_initializes_only_database_dependencies(
    database_app_with_containers: Flask,
    database_session_with_containers: Session,
) -> None:
    assert database_session_with_containers.scalar(text("SELECT 1")) == 1
    assert "sqlalchemy" in database_app_with_containers.extensions
    assert "redis" not in database_app_with_containers.extensions
    assert not database_app_with_containers.blueprints


def test_4_no_application_table_state_leaked_from_preceding_tests(
    transactional_db_session: Session,
) -> None:
    """Detect database state leaked by tests collected before this module."""
    nonempty_tables = {
        table.name: row_count
        for table in db.metadata.sorted_tables
        if (row_count := transactional_db_session.scalar(select(func.count()).select_from(table)))
    }

    assert nonempty_tables == {}
