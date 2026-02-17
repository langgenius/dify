import logging
import os
import pathlib
import random
import secrets
from collections.abc import Generator

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from app_factory import create_app
from configs.app_config import DifyConfig
from extensions.ext_database import db
from models import Account, DifySetup, Tenant, TenantAccountJoin
from services.account_service import AccountService, RegisterService

_DEFUALT_TEST_ENV = ".env"
_DEFAULT_VDB_TEST_ENV = "vdb.env"

_logger = logging.getLogger(__name__)


# Loading the .env file if it exists
def _load_env():
    current_file_path = pathlib.Path(__file__).absolute()
    # Items later in the list have higher precedence.
    env_file_paths = [
        os.getenv("DIFY_TEST_ENV_FILE", str(current_file_path.parent / _DEFUALT_TEST_ENV)),
        os.getenv("DIFY_VDB_TEST_ENV_FILE", str(current_file_path.parent / _DEFAULT_VDB_TEST_ENV)),
    ]

    for env_path_str in env_file_paths:
        if not pathlib.Path(env_path_str).exists():
            _logger.warning("specified configuration file %s not exist", env_path_str)

        from dotenv import load_dotenv

        # Set `override=True` to ensure values from `vdb.env` take priority over values from `.env`
        load_dotenv(str(env_path_str), override=True)


_load_env()
# Override storage root to tmp to avoid polluting repo during local runs
os.environ["OPENDAL_FS_ROOT"] = "/tmp/dify-storage"
os.environ.setdefault("STORAGE_TYPE", "opendal")
os.environ.setdefault("OPENDAL_SCHEME", "fs")

_CACHED_APP = create_app()


@pytest.fixture(scope="session")
def dify_config() -> DifyConfig:
    config = DifyConfig()  # type: ignore
    return config


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
