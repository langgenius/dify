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
    container_app: Flask,
    container_session: Session,
) -> None:
    account = Account(
        name="Container State Isolation",
        email=ACCOUNT_EMAIL,
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )
    container_session.add(account)
    container_session.commit()

    with container_app.app_context():
        ext_redis.redis_client.set(REDIS_KEY, "leaked")
        assert ext_redis.redis_client.get(REDIS_KEY) == b"leaked"


@pytest.mark.requires_redis
def test_2_container_state_is_flushed_between_tests(
    container_app: Flask,
    container_session: Session,
) -> None:
    assert container_session.query(Account).filter_by(email=ACCOUNT_EMAIL).one_or_none() is None

    with container_app.app_context():
        assert ext_redis.redis_client.get(REDIS_KEY) is None


def test_3_database_app_initializes_only_database_dependencies(
    container_db_app: Flask,
    container_db_session: Session,
) -> None:
    assert container_db_session.scalar(text("SELECT 1")) == 1
    assert "sqlalchemy" in container_db_app.extensions
    assert "redis" not in container_db_app.extensions
    assert not container_db_app.blueprints


def test_4_no_application_table_state_leaked_from_preceding_tests(
    container_transaction: Session,
) -> None:
    """Detect database state leaked by tests collected before this module."""
    nonempty_tables = {
        table.name: row_count
        for table in db.metadata.sorted_tables
        if (row_count := container_transaction.scalar(select(func.count()).select_from(table)))
    }

    assert nonempty_tables == {}
