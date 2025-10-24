import pathlib
import random
import secrets
from collections.abc import Generator

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from app_factory import create_app
from extensions.ext_database import db
from models import Account, DifySetup, Tenant, TenantAccountJoin
from services.account_service import AccountService, RegisterService


# Loading the .env file if it exists
def _load_env():
    current_file_path = pathlib.Path(__file__).absolute()
    # Items later in the list have higher precedence.
    files_to_load = [".env", "vdb.env"]

    env_file_paths = [current_file_path.parent / i for i in files_to_load]
    for path in env_file_paths:
        if not path.exists():
            continue

        from dotenv import load_dotenv

        # Set `override=True` to ensure values from `vdb.env` take priority over values from `.env`
        load_dotenv(str(path), override=True)


_load_env()

_CACHED_APP = create_app()


@pytest.fixture
def flask_app() -> Flask:
    return _CACHED_APP


@pytest.fixture(scope="session")
def setup_account(request) -> Generator[Account, None, None]:
    """`dify_setup` completes the setup process for the Dify application.

    It creates `Account` and `Tenant`, and inserts a `DifySetup` record into the database.

    Most tests in the `controllers` package may require dify has been successfully setup.
    """
    with _CACHED_APP.test_request_context():
        rand_suffix = random.randint(int(1e6), int(1e7))  # noqa
        name = f"test-user-{rand_suffix}"
        email = f"{name}@example.com"
        RegisterService.setup(
            email=email,
            name=name,
            password=secrets.token_hex(16),
            ip_address="localhost",
            language="en-US",
        )

    with _CACHED_APP.test_request_context():
        with Session(bind=db.engine, expire_on_commit=False) as session:
            account = session.query(Account).filter_by(email=email).one()

    yield account

    with _CACHED_APP.test_request_context():
        db.session.query(DifySetup).delete()
        db.session.query(TenantAccountJoin).delete()
        db.session.query(Account).delete()
        db.session.query(Tenant).delete()
        db.session.commit()


@pytest.fixture
def flask_req_ctx():
    with _CACHED_APP.test_request_context():
        yield


@pytest.fixture
def auth_header(setup_account) -> dict[str, str]:
    token = AccountService.get_account_jwt_token(setup_account)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_client() -> Generator[FlaskClient, None, None]:
    with _CACHED_APP.test_client() as client:
        yield client
