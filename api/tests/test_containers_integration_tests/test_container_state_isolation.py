from __future__ import annotations

from uuid import uuid4

from flask import Flask
from sqlalchemy.orm import Session

from extensions.ext_redis import redis_client
from models.account import Account

ACCOUNT_EMAIL = f"container-state-isolation-{uuid4()}@example.com"
REDIS_KEY = f"container-state-isolation:{uuid4()}"


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
        redis_client.set(REDIS_KEY, "leaked")
        assert redis_client.get(REDIS_KEY) == b"leaked"


def test_2_container_state_is_flushed_between_tests(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    assert db_session_with_containers.query(Account).filter_by(email=ACCOUNT_EMAIL).one_or_none() is None

    with flask_app_with_containers.app_context():
        assert redis_client.get(REDIS_KEY) is None
