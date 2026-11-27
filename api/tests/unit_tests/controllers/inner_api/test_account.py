"""Account password recovery through HTTP, real persistence, and the Redis key wrapper."""

import base64
import binascii
import hashlib
import hmac
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.inner_api import account as controller
from controllers.inner_api import bp
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from libs.password import compare_password
from models.account import Account
from tests.helpers.unit.redis_commands import RedisCommandEmulator

ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
PATH = f"/inner/api/enterprise/accounts/{ACCOUNT_ID}:resetPassword"
NEW_PASSWORD = "NewPassword123!"


@pytest.fixture
def recovery_client(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> tuple[FlaskClient, RedisCommandEmulator]:
    """Mount the real route with application services and in-memory Redis commands."""
    config_overrides(INNER_API=True, INNER_API_KEY="test-inner-key")
    redis, commands = redis_transport
    state = RedisCommandEmulator()
    commands.side_effect = state
    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=dify_config.DEPLOYMENT_EDITION,
        initialization_password="",
        redis=redis,
    )
    with sqlite_session_factory.begin() as session:
        account = Account(
            name="Locked User", email="Locked.User@Example.com", password="old-hash", password_salt="old-salt"
        )
        account.id = ACCOUNT_ID
        session.add(account)
    monkeypatch.setattr(controller, "application_services", lambda: services)
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    app = Flask(__name__)
    app.register_blueprint(bp)
    return app.test_client(), state


@pytest.mark.parametrize(
    ("prefix", "physical_key"),
    [
        ("", "login_error_rate_limit:locked.user@example.com"),
        (" tenant-a ", "tenant-a:login_error_rate_limit:locked.user@example.com"),
    ],
)
@pytest.mark.parametrize("pepper", ["", "test-password-pepper"])
def test_reset_saves_a_compatible_password_and_clears_only_the_target_lockout(
    recovery_client: tuple[FlaskClient, RedisCommandEmulator],
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    prefix: str,
    physical_key: str,
    pepper: str,
) -> None:
    """Resetting uses Dify's pepper and stored email, without touching other lockouts."""
    config_overrides(REDIS_KEY_PREFIX=prefix, PASSWORD_PEPPER=pepper)
    client, state = recovery_client
    state.values.update(
        {
            "login_error_rate_limit:locked.user@example.com": b"6",
            "tenant-a:login_error_rate_limit:locked.user@example.com": b"6",
            "tenant-b:login_error_rate_limit:locked.user@example.com": b"7",
            "login_error_rate_limit:other@example.com": b"8",
            "tenant-a:login_error_rate_limit:other@example.com": b"8",
            "forgot_password_error_rate_limit:locked.user@example.com": b"9",
        }
    )
    expected = dict(state.values)
    del expected[physical_key]

    for _ in range(2):
        response = client.post(PATH, json={"new_password": NEW_PASSWORD}, headers={"X-Inner-Api-Key": "test-inner-key"})
        assert response.status_code == 200
        assert response.json == {"message": "success"}
        assert state.values == expected
        with sqlite_session_factory() as session:
            account = session.get(Account, ACCOUNT_ID)
            assert account is not None
            assert account.password is not None
            assert account.password_salt is not None
            assert compare_password(NEW_PASSWORD, account.password, account.password_salt)
            digest = hashlib.pbkdf2_hmac(
                "sha256", NEW_PASSWORD.encode(), base64.b64decode(account.password_salt), 10000
            )
            if pepper:
                digest = hmac.new(pepper.encode(), digest, hashlib.sha256).digest()
            assert base64.b64decode(account.password) == binascii.hexlify(digest)
            assert account.email == "Locked.User@Example.com"


@pytest.mark.parametrize("api_key", [None, "wrong-key"])
def test_reset_rejects_unauthorized_callers(
    recovery_client: tuple[FlaskClient, RedisCommandEmulator],
    sqlite_session_factory: sessionmaker[Session],
    api_key: str | None,
) -> None:
    """Unauthenticated calls cannot reset credentials or clear login failures."""
    client, state = recovery_client
    state.values["login_error_rate_limit:locked.user@example.com"] = b"6"
    headers = {} if api_key is None else {"X-Inner-Api-Key": api_key}
    response = client.post(PATH, json={"new_password": NEW_PASSWORD}, headers=headers)
    assert response.status_code == 401
    assert state.values == {"login_error_rate_limit:locked.user@example.com": b"6"}
    with sqlite_session_factory() as session:
        account = session.get(Account, ACCOUNT_ID)
        assert account is not None
        assert (account.password, account.password_salt) == ("old-hash", "old-salt")


@pytest.mark.parametrize(
    ("payload", "status"),
    [({}, 422), ({"new_password": "short"}, 400), ({"new_password": "LettersOnly"}, 400)],
)
def test_reset_rejects_invalid_password_without_changing_credentials_or_lockout(
    recovery_client: tuple[FlaskClient, RedisCommandEmulator],
    sqlite_session_factory: sessionmaker[Session],
    payload: dict[str, str],
    status: int,
) -> None:
    """Invalid passwords leave both persisted credentials and failure counts unchanged."""
    client, state = recovery_client
    state.values["login_error_rate_limit:locked.user@example.com"] = b"6"
    response = client.post(PATH, json=payload, headers={"X-Inner-Api-Key": "test-inner-key"})
    assert response.status_code == status
    assert state.values == {"login_error_rate_limit:locked.user@example.com": b"6"}
    with sqlite_session_factory() as session:
        account = session.get(Account, ACCOUNT_ID)
        assert account is not None
        assert (account.password, account.password_salt) == ("old-hash", "old-salt")


def test_reset_rejects_missing_account(recovery_client: tuple[FlaskClient, RedisCommandEmulator]) -> None:
    """Unknown account IDs do not reset any login failures."""
    client, state = recovery_client
    state.values["login_error_rate_limit:locked.user@example.com"] = b"6"
    path = "/inner/api/enterprise/accounts/22222222-2222-4222-8222-222222222222:resetPassword"
    response = client.post(path, json={"new_password": NEW_PASSWORD}, headers={"X-Inner-Api-Key": "test-inner-key"})
    assert response.status_code == 404
    assert state.values == {"login_error_rate_limit:locked.user@example.com": b"6"}
