import os
from collections.abc import Iterator
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

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

from core.db.session_factory import configure_session_factory, session_factory
from extensions import ext_redis
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase


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


@pytest.fixture
def sqlite_engine() -> Iterator[Engine]:
    """Create an isolated in-memory SQLite engine for tests that need a disposable database."""

    engine = create_engine("sqlite:///:memory:")
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def sqlite_session(request: pytest.FixtureRequest, sqlite_engine: Engine) -> Iterator[Session]:
    """Yield a SQLite session after creating the model tables passed through ``request.param``."""

    models: tuple[type[TypeBase], ...] = request.param
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with session_factory() as session:
        yield session


@pytest.fixture(autouse=True)
def _configure_session_factory(_unit_test_engine):
    try:
        session_factory.get_session_maker()
    except RuntimeError:
        configure_session_factory(_unit_test_engine, expire_on_commit=False)


def persist_service_api_tenant_owner(session: Session, tenant: Tenant, owner: Account) -> TenantAccountJoin:
    """Persist the owner identity resolved by service-API app authentication.

    The legacy name is retained temporarily for consumers on independent
    conversion branches, but this helper no longer fabricates an execute result.
    """
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=owner.id,
        role=TenantAccountRole.OWNER,
    )
    owner._current_tenant = tenant
    session.add_all([tenant, owner, membership])
    session.commit()
    return membership


def persist_service_api_dataset_owner(
    session: Session,
    tenant: Tenant,
    tenant_account_join: TenantAccountJoin,
) -> None:
    """Persist the tenant-owner mapping resolved by dataset-token authentication."""
    session.add_all([tenant, tenant_account_join])
    session.commit()


# Compatibility aliases for controller files converted on independent branches.
# Both names now require a real Session and persist rows; neither fabricates ORM results.
setup_mock_tenant_owner_execute_result = persist_service_api_tenant_owner
setup_mock_dataset_owner_execute_result = persist_service_api_dataset_owner
