from __future__ import annotations

import os
import shutil
from collections.abc import Callable, Iterator
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, create_autospec, patch

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import Session, sessionmaker

if TYPE_CHECKING:
    from extensions.ext_application_services import ApplicationServices
    from tests.unit_tests.account_domain import AccountDomain

# Getting the absolute path of the current file's directory
ABS_PATH = os.path.dirname(os.path.abspath(__file__))

# Getting the absolute path of the project's root directory
PROJECT_DIR = os.path.abspath(os.path.join(ABS_PATH, os.pardir, os.pardir))

CACHED_APP = Flask(__name__)

pytest_plugins = ("tests.unit_tests.audio_runtime_fixtures",)

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
from tests.unit_tests.config_override import apply_config_overrides

if TYPE_CHECKING:
    from extensions.application_services.app import AppServices
    from services.tag_application_service import TagApplicationService


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
def redis_transport(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[ext_redis.RedisClientWrapper, MagicMock]]:
    """Exercise the wrapper and Redis command builders with network dispatch replaced."""
    apply_config_overrides(monkeypatch, REDIS_KEY_PREFIX="")
    with Redis() as client, patch.object(client, "execute_command", return_value=None) as commands:
        wrapper = ext_redis.RedisClientWrapper()
        wrapper.initialize(client)
        yield wrapper, commands


@pytest.fixture
def tenant_queue_commands(
    redis_transport: tuple[ext_redis.RedisClientWrapper, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> MagicMock:
    """Run tenant queue serialization and command building without Redis I/O."""
    from core.rag.pipeline import queue

    redis, commands = redis_transport
    monkeypatch.setattr(queue, "redis_client", redis)
    return commands


@pytest.fixture
def app() -> Flask:
    return CACHED_APP


@pytest.fixture(autouse=True)
def _provide_app_context(app: Flask) -> Iterator[None]:
    with app.app_context():
        yield


@pytest.fixture(autouse=True)
def _patch_redis_clients() -> Iterator[None]:
    """Patch and rebind loaded Redis clients to the shared mock for each unit test."""

    with (
        patch.object(ext_redis, "redis_client", redis_mock),
        patch.object(ext_redis, "_pubsub_redis_client", redis_mock),
    ):
        _patch_redis_clients_on_loaded_modules()
        yield


@pytest.fixture(autouse=True)
def reset_redis_mock(_patch_redis_clients: None) -> None:
    """Reset the shared Redis mock after per-test client rebinding."""
    redis_mock.reset_mock()
    # Restoring a monkeypatched method can leave it detached from the parent's reset traversal.
    redis_mock.delete.reset_mock()
    redis_mock.get.reset_mock()
    redis_mock.setex.reset_mock()
    redis_mock.setnx.reset_mock()
    redis_mock.lock.reset_mock()
    redis_mock.exists.reset_mock()
    redis_mock.set.reset_mock()
    redis_mock.expire.reset_mock()
    redis_mock.hgetall.reset_mock()
    redis_mock.hdel.reset_mock()
    redis_mock.incr.reset_mock()
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


@pytest.fixture(autouse=True)
def reset_secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure SECRET_KEY-dependent logic sees an empty config value by default."""
    apply_config_overrides(monkeypatch, SECRET_KEY="")


@pytest.fixture
def config_overrides(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Temporarily override fields on the shared typed application config.

    Application modules import the same config instance, so mutating known
    field names keeps tests scoped without replacing that instance with an
    unconstrained mock. ``monkeypatch`` restores every value after the test.
    """

    def apply(**values: object) -> None:
        apply_config_overrides(monkeypatch, **values)

    return apply


@pytest.fixture
def _sqlite_engine(_sqlite_database_template: Path) -> Iterator[Engine]:
    """Copy the schema into an isolated directory without pytest's numbered scan.

    ``tmp_path`` searches all preceding test directories for a free number. This
    autouse dependency needs only a unique, disposable directory, including any
    SQLite journal files, so keep it separate from test-owned ``tmp_path`` data.
    """
    with TemporaryDirectory(prefix="case-", dir=_sqlite_database_template.parent) as directory:
        database_path = Path(directory) / "unit-tests.sqlite3"
        shutil.copyfile(_sqlite_database_template, database_path)
        engine = create_engine(URL.create("sqlite", database=str(database_path)))

        try:
            yield engine
        finally:
            engine.dispose()


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


@pytest.fixture
def account_domain(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> AccountDomain:
    from blinker import Signal

    from enums import DeploymentEdition
    from services.workspace import gateways
    from tests.unit_tests.account_domain import build_account_domain

    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, RBAC_ENABLED=False)
    monkeypatch.setattr(gateways, "generate_key_pair", lambda _workspace_id: "public-key")
    monkeypatch.setattr(gateways, "tenant_was_created", Signal())
    return build_account_domain(sqlite_session_factory)


@pytest.fixture
def account_application_services(
    sqlite_session_factory: sessionmaker[Session], account_domain: AccountDomain
) -> ApplicationServices:
    from dataclasses import replace

    from enums import DeploymentEdition
    from extensions.ext_application_services import build_application_services
    from extensions.ext_redis import RedisClientWrapper

    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=create_autospec(RedisClientWrapper, instance=True),
    )
    return replace(
        services,
        accounts=replace(services.accounts, lifecycle=account_domain.accounts),
        workspaces=replace(
            services.workspaces,
            members=account_domain.members,
            provisioning=account_domain.provisioning,
            invitations=account_domain.invitations,
        ),
    )


@pytest.fixture
def app_services(sqlite_session_factory: sessionmaker[Session]) -> AppServices:
    from unittest.mock import Mock

    from extensions.application_services.app import build_app_services
    from extensions.ext_application_services import _build_oauth_server_service
    from extensions.ext_redis import redis_client
    from services.recommended_app_package_service import RecommendedAppPackageService

    return build_app_services(
        database_client=sqlite_session_factory,
        oauth=_build_oauth_server_service(database_client=sqlite_session_factory, redis=redis_client),
        recommended_packages=RecommendedAppPackageService(sources=Mock(), exporter=Mock()),
    )


@pytest.fixture
def application_tags(sqlite_session_factory: sessionmaker[Session]) -> TagApplicationService:
    from repositories.tag_repository import TagRepository
    from services.tag_application_service import TagApplicationService

    return TagApplicationService(tags=TagRepository(sqlite_session_factory))
