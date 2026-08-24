import os
import shutil
from collections.abc import Callable, Iterator
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine
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

import core.db.session_factory as session_factory_module
from extensions import ext_redis
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase


def _patch_redis_clients_on_loaded_modules() -> None:
    """Ensure any module-level redis_client references point to the shared redis_mock."""

    import sys

    for module in list(sys.modules.values()):
        if module is None:
            continue
        for client_attribute in ("redis_client", "_pubsub_redis_client"):
            if hasattr(module, client_attribute):
                setattr(module, client_attribute, redis_mock)


@pytest.fixture
def app() -> Flask:
    return CACHED_APP


@pytest.fixture(autouse=True)
def _provide_app_context(app: Flask) -> Iterator[None]:
    with app.app_context():
        yield


@pytest.fixture(autouse=True)
def _patch_redis_clients() -> Iterator[None]:
    """Patch redis_client to MagicMock only for unit test executions."""

    with (
        patch.object(ext_redis, "redis_client", redis_mock),
        patch.object(ext_redis, "_pubsub_redis_client", redis_mock),
    ):
        _patch_redis_clients_on_loaded_modules()
        yield


@pytest.fixture(autouse=True)
def reset_redis_mock() -> None:
    """reset the Redis mock before each test"""
    redis_mock.reset_mock()
    redis_mock.get.return_value = None
    redis_mock.setex.return_value = None
    redis_mock.setnx.return_value = None
    redis_mock.delete.return_value = None
    redis_mock.exists.return_value = False
    redis_mock.set.return_value = None
    redis_mock.expire.return_value = None
    redis_mock.hgetall.return_value = dict[bytes, bytes]()
    redis_mock.hdel.return_value = None
    redis_mock.incr.return_value = 1

    # Keep any imported modules pointing at the mock between tests
    _patch_redis_clients_on_loaded_modules()


@pytest.fixture(autouse=True)
def reset_secret_key() -> Iterator[None]:
    """Ensure SECRET_KEY-dependent logic sees an empty config value by default."""

    from configs import dify_config

    original = dify_config.SECRET_KEY
    dify_config.SECRET_KEY = ""
    try:
        yield
    finally:
        dify_config.SECRET_KEY = original


@pytest.fixture
def config_overrides(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Temporarily override fields on the shared typed application config.

    Application modules import the same config instance, so mutating known
    field names keeps tests scoped without replacing that instance with an
    unconstrained mock. ``monkeypatch`` restores every value after the test.
    """
    from configs import dify_config

    def apply(**values: object) -> None:
        unknown_fields = values.keys() - type(dify_config).model_fields.keys()
        if unknown_fields:
            raise ValueError(f"Unknown DifyConfig fields: {sorted(unknown_fields)}")
        for name, value in values.items():
            monkeypatch.setattr(dify_config, name, value)

    return apply


@pytest.fixture
def _sqlite_engine(_sqlite_database_template: Path, tmp_path: Path) -> Iterator[Engine]:
    """Create an engine over a pristine per-test copy of the SQLite schema."""

    database_path = tmp_path / "unit-tests.sqlite3"
    shutil.copyfile(_sqlite_database_template, database_path)
    engine = create_engine(URL.create("sqlite", database=str(database_path)))

    try:
        yield engine
    finally:
        engine.dispose()
        database_path.unlink(missing_ok=True)


@pytest.fixture(scope="session")
def _sqlite_database_template(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Create one empty full-schema SQLite database per pytest worker."""

    database_path = tmp_path_factory.mktemp("sqlite-template") / "unit-tests.sqlite3"
    engine = create_engine(URL.create("sqlite", database=str(database_path)))
    try:
        TypeBase.metadata.create_all(engine)
    finally:
        engine.dispose()
    return database_path


@pytest.fixture(autouse=True)
def _sqlite_session_factory(
    _sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> sessionmaker[Session]:
    """Bind all unit-test Sessions to the pristine full-schema SQLite database."""

    factory = sessionmaker(bind=_sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(session_factory_module, "_session_maker", factory)
    return factory


@pytest.fixture
def _unbound_session_factory(
    _sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> sessionmaker[Session]:
    """Create one unbound factory and install it as the global test factory."""

    factory = sessionmaker()
    monkeypatch.setattr(session_factory_module, "_session_maker", factory)
    return factory


@pytest.fixture
def sqlite_engine(_sqlite_engine: Engine) -> Engine:
    """Expose the pristine full-schema SQLite engine to tests."""

    return _sqlite_engine


@pytest.fixture
def sqlite_session_factory(_sqlite_session_factory: sessionmaker[Session]) -> sessionmaker[Session]:
    """Expose the shared SQLite session factory to tests."""

    return _sqlite_session_factory


@pytest.fixture
def sqlite_session(_sqlite_session_factory: sessionmaker[Session]) -> Iterator[Session]:
    """Yield a session over the pristine full-schema SQLite database.

    Legacy indirect model parameters remain accepted by pytest but are ignored.
    Remove those decorators as their test files receive individual review.
    """

    with _sqlite_session_factory() as session:
        yield session


@pytest.fixture
def unbound_session_factory(_unbound_session_factory: sessionmaker[Session]) -> sessionmaker[Session]:
    """Expose an unbound factory for paths that must not require persistence."""

    return _unbound_session_factory


@pytest.fixture
def unbound_session(_unbound_session_factory: sessionmaker[Session]) -> Iterator[Session]:
    """Yield an unbound Session for paths that must not require persistence.

    Bind-requiring database access fails, while bind-free Session operations can
    still succeed.
    """

    with _unbound_session_factory() as session:
        yield session


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


def setup_mock_tenant_owner_execute_result(mock_db: MagicMock, mock_tenant: object, mock_owner: object) -> None:
    """Stub the legacy owner query; SQLite-backed tests use ``persist_service_api_tenant_owner``."""
    mock_db.session.execute.return_value.one_or_none.return_value = (mock_tenant, mock_owner)


def setup_mock_dataset_owner_execute_result(
    mock_db: MagicMock,
    mock_tenant: object,
    mock_tenant_account_join: object,
) -> None:
    """Stub the legacy dataset-owner query; SQLite tests use ``persist_service_api_dataset_owner``."""
    mock_db.session.execute.return_value.one_or_none.return_value = (
        mock_tenant,
        mock_tenant_account_join,
    )
