import os
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import create_engine

# Getting the absolute path of the current file's directory
ABS_PATH = os.path.dirname(os.path.abspath(__file__))

# Getting the absolute path of the project's root directory
PROJECT_DIR = os.path.abspath(os.path.join(ABS_PATH, os.pardir, os.pardir))

CACHED_APP = Flask(__name__)

# set global mock for Redis client
redis_mock = MagicMock()
redis_mock.get = MagicMock(return_value=None)
redis_mock.setex = MagicMock()
redis_mock.setnx = MagicMock()
redis_mock.delete = MagicMock()
redis_mock.lock = MagicMock()
redis_mock.exists = MagicMock(return_value=False)
redis_mock.set = MagicMock()
redis_mock.expire = MagicMock()
redis_mock.hgetall = MagicMock(return_value={})
redis_mock.hdel = MagicMock()
redis_mock.incr = MagicMock(return_value=1)

# Ensure OpenDAL fs writes to tmp to avoid polluting workspace
os.environ.setdefault("OPENDAL_SCHEME", "fs")
os.environ.setdefault("OPENDAL_FS_ROOT", "/tmp/dify-storage")
os.environ.setdefault("STORAGE_TYPE", "opendal")

# Add the API directory to Python path to ensure proper imports
import sys

sys.path.insert(0, PROJECT_DIR)

from core.db.session_factory import configure_session_factory, session_factory
from extensions import ext_redis


def _patch_redis_clients_on_loaded_modules():
    """Ensure any module-level redis_client references point to the shared redis_mock."""

    import sys

    for module in list(sys.modules.values()):
        if module is None:
            continue
        if hasattr(module, "redis_client"):
            module.redis_client = redis_mock
        if hasattr(module, "_pubsub_redis_client"):
            module.pubsub_redis_client = redis_mock


@pytest.fixture
def app() -> Flask:
    return CACHED_APP


@pytest.fixture(autouse=True)
def _provide_app_context(app: Flask):
    with app.app_context():
        yield


@pytest.fixture(autouse=True)
def _patch_redis_clients():
    """Patch redis_client to MagicMock only for unit test executions."""

    with (
        patch.object(ext_redis, "redis_client", redis_mock),
        patch.object(ext_redis, "_pubsub_redis_client", redis_mock),
    ):
        _patch_redis_clients_on_loaded_modules()
        yield


@pytest.fixture(autouse=True)
def reset_redis_mock():
    """reset the Redis mock before each test"""
    redis_mock.reset_mock()
    redis_mock.get.return_value = None
    redis_mock.setex.return_value = None
    redis_mock.setnx.return_value = None
    redis_mock.delete.return_value = None
    redis_mock.exists.return_value = False
    redis_mock.set.return_value = None
    redis_mock.expire.return_value = None
    redis_mock.hgetall.return_value = {}
    redis_mock.hdel.return_value = None
    redis_mock.incr.return_value = 1

    # Keep any imported modules pointing at the mock between tests
    _patch_redis_clients_on_loaded_modules()


@pytest.fixture(autouse=True)
def reset_secret_key():
    """Ensure SECRET_KEY-dependent logic sees an empty config value by default."""

    from configs import dify_config

    original = dify_config.SECRET_KEY
    dify_config.SECRET_KEY = ""
    try:
        yield
    finally:
        dify_config.SECRET_KEY = original


@pytest.fixture(scope="session")
def _unit_test_engine():
    engine = create_engine("sqlite:///:memory:")
    yield engine
    engine.dispose()


@pytest.fixture(autouse=True)
def _configure_session_factory(_unit_test_engine):
    try:
        session_factory.get_session_maker()
    except RuntimeError:
        configure_session_factory(_unit_test_engine, expire_on_commit=False)


def setup_mock_tenant_account_query(mock_db, mock_tenant, mock_account):
    """
    Helper to set up the mock DB query chain for tenant/account authentication.

    This configures the mock to return (tenant, account) for the join query used
    by validate_app_token and validate_dataset_token decorators.

    Args:
        mock_db: The mocked db object
        mock_tenant: Mock tenant object to return
        mock_account: Mock account object to return
    """
    query = mock_db.session.query.return_value
    join_chain = query.join.return_value.join.return_value
    where_chain = join_chain.where.return_value
    where_chain.one_or_none.return_value = (mock_tenant, mock_account)


def setup_mock_dataset_tenant_query(mock_db, mock_tenant, mock_ta):
    """
    Helper to set up the mock DB query chain for dataset tenant authentication.

    This configures the mock to return (tenant, tenant_account) for the where chain
    query used by validate_dataset_token decorator.

    Args:
        mock_db: The mocked db object
        mock_tenant: Mock tenant object to return
        mock_ta: Mock tenant account object to return
    """
    query = mock_db.session.query.return_value
    where_chain = query.where.return_value.where.return_value.where.return_value.where.return_value
    where_chain.one_or_none.return_value = (mock_tenant, mock_ta)
