"""Testcontainers infrastructure and isolation fixtures for Dify API tests.

PostgreSQL is always available; Redis, Sandbox, and Plugin Daemon are selected from
``--tc-services`` or inferred from collected tests. The containers are session-scoped,
while database and Redis state are isolated per test.

Choose fixtures by application cost and isolation needs:

- Every public infrastructure fixture starts with ``container_``. The optional
  ``db_`` segment always means the lightweight database-only application; fixtures
  without it use the full Dify application.
- ``container_db_app`` initializes only database/session extensions;
  ``container_app`` initializes the complete Dify application.
- ``container_db_session`` and ``container_session`` use direct
  sessions followed by table truncation. Keep these for writes that escape the shared
  application connection.
- ``container_db_transaction`` and ``container_transaction`` bind Dify sessions to
  one outer transaction and roll it back. They are valid only when every database path
  used by the test shares the rebound application connection.
- ``container_state`` performs fresh assertions after full-application request teardown.
"""

import logging
import os
from collections.abc import Generator, MutableMapping
from contextlib import contextmanager
from pathlib import Path
from typing import Protocol, cast

import psycopg2
import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.core.container import DockerContainer
from testcontainers.core.network import Network
from testcontainers.core.wait_strategies import LogMessageWaitStrategy
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

import core.db.session_factory as session_factory_module
from extensions.ext_database import db
from tests.test_containers_integration_tests.helpers import DatabaseState

# Configure logging for test containers
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
_TEST_STORAGE_ROOT = os.getenv("DIFY_TESTCONTAINERS_STORAGE_ROOT", "/tmp/dify-storage")

# Controller modules can initialize storage while pytest is still collecting.
# Pin test storage and signing state before those modules import. The explicit
# SECRET_KEY also survives config reloads when the full and database-only apps
# are initialized in either order.
os.environ["STORAGE_TYPE"] = "opendal"
os.environ["OPENDAL_SCHEME"] = "fs"
os.environ["OPENDAL_FS_ROOT"] = _TEST_STORAGE_ROOT
os.environ["SECRET_KEY"] = "dify-testcontainers-only-secret-key-for-hs256"

DEFAULT_SANDBOX_TEST_IMAGE = "langgenius/dify-sandbox:0.2.14"
SANDBOX_TEST_IMAGE_ENV = "DIFY_SANDBOX_TEST_IMAGE"
_ALL_CONTAINER_SERVICES = frozenset({"postgres", "redis", "sandbox", "plugin-daemon"})
_SERVICE_MARKERS = {
    "requires_redis": "redis",
    "requires_sandbox": "sandbox",
    "requires_plugin_daemon": "plugin-daemon",
}
_AUTO_PATH_REQUIREMENTS = {
    "/workflow/nodes/code_executor/": frozenset({"sandbox"}),
}
_REDIS_SOURCE_IMPORTS = (
    "from extensions.ext_redis import redis_client",
    "from extensions.ext_redis import redis_client,",
    'app.extensions["redis"]',
    "app.extensions['redis']",
)


class _CloserProtocol(Protocol):
    """Resource that can be closed after temporary use."""

    def close(self) -> None: ...


@contextmanager
def _auto_close[T: _CloserProtocol](closer: T) -> Generator[T, None, None]:
    """Close a resource even when the managed block raises."""
    try:
        yield closer
    finally:
        closer.close()


def _wait_for_log_message(message: str, timeout: int) -> LogMessageWaitStrategy:
    return LogMessageWaitStrategy(message).with_startup_timeout(timeout)


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("dify-testcontainers")
    group.addoption(
        "--tc-services",
        default=os.getenv("DIFY_TESTCONTAINERS_SERVICES", "auto"),
        help="Testcontainer services: auto, all, or a comma-separated postgres/redis/sandbox/plugin-daemon list.",
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "requires_redis: start a real Redis testcontainer")
    config.addinivalue_line("markers", "requires_sandbox: start a real code-execution Sandbox testcontainer")
    config.addinivalue_line("markers", "requires_plugin_daemon: start a real Plugin Daemon testcontainer")
    config.addinivalue_line(
        "markers",
        "no_container_truncate: skip the legacy post-test TRUNCATE reset when another isolation strategy owns cleanup",
    )
    if config.option.numprocesses:
        raise pytest.UsageError(
            "xdist is disabled for testcontainers integration tests because each worker creates a full container stack"
        )


def _with_service_dependencies(services: set[str]) -> frozenset[str]:
    """Add services that are mandatory for every stack or required by another service."""
    expanded = set(services)
    expanded.add("postgres")
    if "plugin-daemon" in expanded:
        expanded.add("redis")
    return frozenset(expanded)


def _source_uses_redis(source_path: Path) -> bool:
    """Detect legacy tests that access Redis but do not yet declare a marker."""
    try:
        source = source_path.read_text(encoding="utf-8")
    except OSError:
        return False
    return any(token in source for token in _REDIS_SOURCE_IMPORTS)


def _parse_requested_services(value: str, items: list[pytest.Item]) -> frozenset[str]:
    """Resolve explicit or collection-derived services, including transitive dependencies."""
    normalized = value.strip().lower()
    if normalized == "all":
        return _ALL_CONTAINER_SERVICES
    if normalized != "auto":
        requested = frozenset(service.strip() for service in normalized.split(",") if service.strip())
        unknown_services = requested - _ALL_CONTAINER_SERVICES
        if unknown_services:
            raise pytest.UsageError(f"Unknown --tc-services values: {', '.join(sorted(unknown_services))}")
        return _with_service_dependencies(set(requested))

    requested_services = {"postgres"}
    redis_source_paths: dict[Path, bool] = {}
    for item in items:
        for marker_name, service in _SERVICE_MARKERS.items():
            if item.get_closest_marker(marker_name) is not None:
                requested_services.add(service)

        normalized_node_id = item.nodeid.replace("\\", "/")
        for path_fragment, services in _AUTO_PATH_REQUIREMENTS.items():
            if path_fragment in normalized_node_id:
                requested_services.update(services)

        source_path = Path(str(item.path))
        if source_path not in redis_source_paths:
            redis_source_paths[source_path] = _source_uses_redis(source_path)
        if redis_source_paths[source_path]:
            requested_services.add("redis")

    return _with_service_dependencies(requested_services)


class DifyTestContainers:
    """Own the selected containers and their shared Docker network for one test session."""

    network: Network | None
    postgres: PostgresContainer | None
    redis: RedisContainer | None
    dify_sandbox: DockerContainer | None
    dify_plugin_daemon: DockerContainer | None
    _started_services: set[str]

    def __init__(self) -> None:
        """Initialize container management with default configurations."""
        self.network: Network | None = None
        self.postgres: PostgresContainer | None = None
        self.redis: RedisContainer | None = None
        self.dify_sandbox: DockerContainer | None = None
        self.dify_plugin_daemon: DockerContainer | None = None
        self._started_services: set[str] = set()
        logger.info("DifyTestContainers initialized - ready to manage test containers")

    @property
    def started_services(self) -> frozenset[str]:
        return frozenset(self._started_services)

    def _ensure_network(self) -> Network:
        if self.network is None:
            logger.info("Creating Docker network for container communication...")
            self.network = Network()
            self.network.create()
            logger.info("Docker network created successfully with name: %s", self.network.name)
        return self.network

    def _start_postgres(self, *, create_plugin_database: bool) -> None:
        if self.postgres is not None:
            return

        network = self._ensure_network()
        logger.info("Initializing PostgreSQL container...")
        self.postgres = PostgresContainer(image="postgres:14-alpine").with_network(network)
        self.postgres.waiting_for(_wait_for_log_message("is ready to accept connections", 30))
        self.postgres.start()
        db_host = self.postgres.get_container_host_ip()
        db_port = self.postgres.get_exposed_port(5432)
        os.environ["DB_HOST"] = db_host
        os.environ["DB_PORT"] = str(db_port)
        os.environ["DB_USERNAME"] = self.postgres.username
        os.environ["DB_PASSWORD"] = self.postgres.password
        os.environ["DB_DATABASE"] = self.postgres.dbname
        logger.info(
            "PostgreSQL container started successfully - Host: %s, Port: %s User: %s, Database: %s",
            db_host,
            db_port,
            self.postgres.username,
            self.postgres.dbname,
        )

        conn = psycopg2.connect(
            host=db_host,
            port=db_port,
            user=self.postgres.username,
            password=self.postgres.password,
            database=self.postgres.dbname,
        )
        conn.autocommit = True
        with _auto_close(conn):
            with conn.cursor() as cursor:
                cursor.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

            if create_plugin_database:
                with _auto_close(conn.cursor()) as cursor:
                    cursor.execute("CREATE DATABASE dify_plugin;")

        os.environ["STORAGE_TYPE"] = "opendal"
        os.environ["OPENDAL_SCHEME"] = "fs"
        os.environ["OPENDAL_FS_ROOT"] = _TEST_STORAGE_ROOT
        self._started_services.add("postgres")

    def _start_redis(self) -> None:
        if self.redis is not None:
            return

        network = self._ensure_network()
        logger.info("Initializing Redis container...")
        self.redis = RedisContainer(image="redis:6-alpine", port=6379).with_network(network)
        self.redis.waiting_for(_wait_for_log_message("Ready to accept connections", 30))
        self.redis.start()
        redis_host = self.redis.get_container_host_ip()
        redis_port = self.redis.get_exposed_port(6379)
        os.environ["REDIS_HOST"] = redis_host
        os.environ["REDIS_PORT"] = str(redis_port)
        self._started_services.add("redis")
        logger.info("Redis container started successfully - Host: %s, Port: %s", redis_host, redis_port)

    def _start_sandbox(self) -> None:
        if self.dify_sandbox is not None:
            return

        network = self._ensure_network()
        sandbox_image = os.getenv(SANDBOX_TEST_IMAGE_ENV, DEFAULT_SANDBOX_TEST_IMAGE)
        logger.info("Initializing Dify Sandbox container...")
        self.dify_sandbox = DockerContainer(image=sandbox_image).with_network(network)
        self.dify_sandbox.with_exposed_ports(8194)
        self.dify_sandbox.waiting_for(_wait_for_log_message("config init success", 60))
        self.dify_sandbox.env = {"API_KEY": "test_api_key"}
        self.dify_sandbox.start()
        sandbox_host = self.dify_sandbox.get_container_host_ip()
        sandbox_port = self.dify_sandbox.get_exposed_port(8194)
        os.environ["CODE_EXECUTION_ENDPOINT"] = f"http://{sandbox_host}:{sandbox_port}"
        os.environ["CODE_EXECUTION_API_KEY"] = "test_api_key"
        self._started_services.add("sandbox")
        logger.info(
            "Dify Sandbox container started successfully - Image: %s Host: %s, Port: %s",
            sandbox_image,
            sandbox_host,
            sandbox_port,
        )

    def _start_plugin_daemon(self) -> None:
        if self.dify_plugin_daemon is not None:
            return

        assert self.postgres is not None
        assert self.redis is not None
        network = self._ensure_network()
        logger.info("Initializing Dify Plugin Daemon container...")
        self.dify_plugin_daemon = DockerContainer(image="langgenius/dify-plugin-daemon:0.5.3-local").with_network(
            network
        )
        self.dify_plugin_daemon.with_exposed_ports(5002)
        self.dify_plugin_daemon.waiting_for(_wait_for_log_message("start plugin manager daemon", 60))
        postgres_container_name = self.postgres.get_wrapped_container().name
        redis_container_name = self.redis.get_wrapped_container().name
        assert postgres_container_name is not None
        assert redis_container_name is not None
        self.dify_plugin_daemon.env = {
            "DB_HOST": postgres_container_name,
            "DB_PORT": "5432",
            "DB_USERNAME": self.postgres.username,
            "DB_PASSWORD": self.postgres.password,
            "DB_DATABASE": "dify_plugin",
            "REDIS_HOST": redis_container_name,
            "REDIS_PORT": "6379",
            "REDIS_PASSWORD": "",
            "SERVER_PORT": "5002",
            "SERVER_KEY": "test_plugin_daemon_key",
            "MAX_PLUGIN_PACKAGE_SIZE": "52428800",
            "PPROF_ENABLED": "false",
            "DIFY_INNER_API_URL": f"http://{postgres_container_name}:5001",
            "DIFY_INNER_API_KEY": "test_inner_api_key",
            "PLUGIN_REMOTE_INSTALLING_HOST": "0.0.0.0",
            "PLUGIN_REMOTE_INSTALLING_PORT": "5003",
            "PLUGIN_WORKING_PATH": "/app/storage/cwd",
            "FORCE_VERIFYING_SIGNATURE": "false",
            "PYTHON_ENV_INIT_TIMEOUT": "120",
            "PLUGIN_MAX_EXECUTION_TIMEOUT": "600",
            "PLUGIN_STDIO_BUFFER_SIZE": "1024",
            "PLUGIN_STDIO_MAX_BUFFER_SIZE": "5242880",
            "PLUGIN_STORAGE_TYPE": "local",
            "PLUGIN_STORAGE_LOCAL_ROOT": "/app/storage",
            "PLUGIN_INSTALLED_PATH": "plugin",
            "PLUGIN_PACKAGE_CACHE_PATH": "plugin_packages",
            "PLUGIN_MEDIA_CACHE_PATH": "assets",
        }
        self.dify_plugin_daemon.start()
        plugin_daemon_host = self.dify_plugin_daemon.get_container_host_ip()
        plugin_daemon_port = self.dify_plugin_daemon.get_exposed_port(5002)
        os.environ["PLUGIN_DAEMON_URL"] = f"http://{plugin_daemon_host}:{plugin_daemon_port}"
        os.environ["PLUGIN_DAEMON_KEY"] = "test_plugin_daemon_key"
        self._started_services.add("plugin-daemon")
        logger.info(
            "Dify Plugin Daemon container started successfully - Host: %s, Port: %s",
            plugin_daemon_host,
            plugin_daemon_port,
        )

    def start_containers_with_env(self, services: frozenset[str] = _ALL_CONTAINER_SERVICES) -> None:
        """Start the requested services in dependency order and publish their endpoints."""
        if self._started_services:
            logger.info("Containers already started - skipping container startup")
            return

        unknown_services = services - _ALL_CONTAINER_SERVICES
        if unknown_services:
            raise ValueError(f"Unknown testcontainer services: {sorted(unknown_services)}")
        requested_services = _with_service_dependencies(set(services))

        os.environ["REDIS_HOST"] = "127.0.0.1"
        os.environ["REDIS_PORT"] = "1"
        os.environ["CODE_EXECUTION_ENDPOINT"] = "http://127.0.0.1:1"
        os.environ["CODE_EXECUTION_API_KEY"] = "test_api_key"
        os.environ["PLUGIN_DAEMON_URL"] = "http://127.0.0.1:1"
        os.environ["PLUGIN_DAEMON_KEY"] = "test_plugin_daemon_key"

        logger.info("Starting testcontainer services: %s", ", ".join(sorted(requested_services)))
        self._start_postgres(create_plugin_database="plugin-daemon" in requested_services)
        if "redis" in requested_services:
            self._start_redis()
        if "sandbox" in requested_services:
            self._start_sandbox()
        if "plugin-daemon" in requested_services:
            self._start_plugin_daemon()
        logger.info("Requested testcontainer services started successfully")

    def stop_containers(self) -> None:
        """
        Stop and clean up all test containers.

        This method ensures proper cleanup of all containers to prevent
        resource leaks and conflicts between test runs.
        """
        containers = [self.dify_plugin_daemon, self.dify_sandbox, self.redis, self.postgres]
        if all(container is None for container in containers) and self.network is None:
            logger.info("No containers to stop - containers were not started")
            return

        logger.info("Stopping and cleaning up test containers...")
        for container in containers:
            if container is not None:
                container_name = container.image
                logger.info("Stopping container: %s", container_name)
                container.stop()
                logger.info("Successfully stopped container: %s", container_name)

        # Stop and remove the network
        if self.network is not None:
            logger.info("Removing Docker network...")
            self.network.remove()
            logger.info("Successfully removed Docker network")

        self.network = None
        self.postgres = None
        self.redis = None
        self.dify_sandbox = None
        self.dify_plugin_daemon = None
        self._started_services.clear()
        logger.info("All test containers stopped and cleaned up successfully")


_container_manager = DifyTestContainers()


_UUIDv7SQL = r"""
/* Main function to generate a uuidv7 value with millisecond precision */
CREATE FUNCTION uuidv7() RETURNS uuid
AS
$$
    -- Replace the first 48 bits of a uuidv4 with the current
    -- number of milliseconds since 1970-01-01 UTC
    -- and set the "ver" field to 7 by setting additional bits
SELECT encode(
               set_bit(
                       set_bit(
                               overlay(uuid_send(gen_random_uuid()) placing
                                       substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from
                                                 3)
                                       from 1 for 6),
                               52, 1),
                       53, 1), 'hex')::uuid;
$$ LANGUAGE SQL VOLATILE PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7 IS
    'Generate a uuid-v7 value with a 48-bit timestamp (millisecond precision) and 74 bits of randomness';

CREATE FUNCTION uuidv7_boundary(timestamptz) RETURNS uuid
AS
$$
    /* uuid fields: version=0b0111, variant=0b10 */
SELECT encode(
               overlay('\x00000000000070008000000000000000'::bytea
                       placing substring(int8send(floor(extract(epoch from $1) * 1000)::bigint) from 3)
                       from 1 for 6),
               'hex')::uuid;
$$ LANGUAGE SQL STABLE STRICT PARALLEL SAFE;

COMMENT ON FUNCTION uuidv7_boundary(timestamptz) IS
    'Generate a non-random uuidv7 with the given timestamp (first 48 bits) and all random bits to 0.
    As the smallest possible uuidv7 for that timestamp, it may be used as a boundary for partitions.';
"""

_database_schema_initialized = False


def _reload_dify_config() -> None:
    from configs import dify_config

    dify_config.__dict__.clear()
    dify_config.__init__()


def _initialize_database_schema(app: Flask) -> None:
    global _database_schema_initialized
    if _database_schema_initialized:
        return

    logger.info("Creating database schema...")
    with app.app_context():
        with db.engine.connect() as conn, conn.begin():
            conn.execute(text(_UUIDv7SQL))
        db.create_all()
    _database_schema_initialized = True
    logger.info("Database schema created successfully")


def _create_container_db_app() -> Flask:
    logger.info("Creating database-only Flask application...")
    _reload_dify_config()

    import models  # noqa: F401
    from configs import dify_config
    from dify_app import DifyApp
    from extensions import ext_database, ext_session_factory

    app = DifyApp("testcontainers-database")
    app.config.from_mapping(dify_config.model_dump())
    ext_database.init_app(app)
    ext_session_factory.init_app(app)
    _initialize_database_schema(app)
    logger.info("Database-only Flask application ready")
    return app


def _create_container_app() -> Flask:
    """Create the full Dify application configured to use the test containers."""
    logger.info("Creating Flask application with test container configuration...")

    # Ensure Redis client reconnects to the containerized Redis (no auth)
    from extensions import ext_redis

    ext_redis.redis_client._client = None
    os.environ["REDIS_USERNAME"] = ""
    os.environ["REDIS_PASSWORD"] = ""

    _reload_dify_config()

    # Create and configure the Flask application
    logger.info("Initializing Flask application...")
    from app_factory import create_app

    _sio_app, app = create_app()
    logger.info("Flask application created successfully")

    _initialize_database_schema(app)

    logger.info("Flask application configured and ready for testing")
    return app


@pytest.fixture(scope="session")
def container_stack(request: pytest.FixtureRequest) -> Generator[DifyTestContainers, None, None]:
    """Start the selected containers once and stop them after the test session."""
    global _database_schema_initialized
    _database_schema_initialized = False
    logger.info("=== Starting test session container management ===")
    try:
        services = _parse_requested_services(request.config.getoption("tc_services"), request.session.items)
        _container_manager.start_containers_with_env(services)
        logger.info("Test containers ready for session")
        yield _container_manager
    finally:
        logger.info("=== Cleaning up test session containers ===")
        _container_manager.stop_containers()
        _database_schema_initialized = False
        logger.info("Test session container cleanup completed")


@pytest.fixture(scope="session")
def container_db_app(container_stack: DifyTestContainers) -> Flask:
    """Provide the lightweight application with only database extensions initialized."""
    assert container_stack is _container_manager
    return _create_container_db_app()


@pytest.fixture(scope="session")
def container_app(container_stack: DifyTestContainers) -> Flask:
    """Provide the fully initialized Dify application backed by the containers."""
    assert container_stack is _container_manager
    logger.info("=== Creating session-scoped Flask application ===")
    app = _create_container_app()
    logger.info("Session-scoped Flask application created successfully")
    return app


@pytest.fixture
def container_request_context(container_app: Flask) -> Generator[None, None, None]:
    """Activate a request context for the full container-backed application."""
    logger.debug("Creating Flask request context...")
    with container_app.test_request_context():
        logger.debug("Flask request context active")
        yield
    logger.debug("Flask request context closed")


@pytest.fixture
def container_client(container_app: Flask) -> Generator[FlaskClient, None, None]:
    """Provide an HTTP client for the full container-backed application."""
    logger.debug("Creating Flask test client...")
    with container_app.test_client() as client:
        logger.debug("Flask test client ready")
        yield client
    logger.debug("Flask test client closed")


@pytest.fixture
def container_session(container_app: Flask) -> Generator[Session, None, None]:
    """Provide a direct full-app session; the autouse cleanup truncates tables afterward."""
    logger.debug("Creating database session...")
    with container_app.app_context():
        session = db.session()
        logger.debug("Database session created and ready")
        try:
            yield session
        finally:
            session.close()
            logger.debug("Database session closed")


@pytest.fixture
def container_db_session(container_db_app: Flask) -> Generator[Session, None, None]:
    """Provide a direct database-only session; the autouse cleanup truncates tables afterward."""
    with container_db_app.app_context():
        session = db.session()
        try:
            yield session
        finally:
            session.close()


@contextmanager
def _bind_test_transaction(app: Flask) -> Generator[Session, None, None]:
    """Bind application sessions to an outer transaction that is rolled back after the test."""
    with app.app_context():
        original_engine = db.engines[None]
        connection = original_engine.connect()
        outer_transaction = connection.begin()
        guard_savepoint = connection.begin_nested()
        engine_registry = cast(MutableMapping[str | None, object], db.engines)
        original_scoped_options = db.session.session_factory.kw.copy()
        original_session_maker = session_factory_module._session_maker

        db.session.remove()
        engine_registry[None] = connection
        db.session.session_factory.configure(join_transaction_mode="create_savepoint")
        session_factory_module._session_maker = sessionmaker(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )

        try:
            yield db.session()
        finally:
            db.session.remove()
            session_factory_module._session_maker = original_session_maker
            db.session.session_factory.kw.clear()
            db.session.session_factory.kw.update(original_scoped_options)
            engine_registry[None] = original_engine

            transaction_was_active = outer_transaction.is_active and guard_savepoint.is_active
            if transaction_was_active:
                outer_transaction.rollback()
            connection.close()

            if not transaction_was_active:
                raise RuntimeError(
                    "The test's outer transaction was ended by application code. "
                    "Keep this test on truncate isolation until its session path is migrated."
                )


@pytest.fixture
def container_db_transaction(
    request: pytest.FixtureRequest,
    container_db_app: Flask,
) -> Generator[Session, None, None]:
    """Provide rollback isolation using the lightweight database-only application."""
    request.node.add_marker(pytest.mark.no_container_truncate)
    with _bind_test_transaction(container_db_app) as session:
        yield session


@pytest.fixture
def container_transaction(
    request: pytest.FixtureRequest,
    container_app: Flask,
) -> Generator[Session, None, None]:
    """Provide rollback isolation for tests that exercise the fully initialized application."""
    request.node.add_marker(pytest.mark.no_container_truncate)
    with _bind_test_transaction(container_app) as session:
        yield session


@pytest.fixture
def container_state(container_transaction: Session) -> DatabaseState:
    """Provide fresh database reads after full-application request teardown."""
    return DatabaseState(container_transaction)


def _truncate_container_database(app: Flask) -> None:
    """
    Reset application tables after a container integration test.

    Tests in this package share one PostgreSQL container for performance, while
    application code may commit through db.session, Session(db.engine), or
    session_factory-created sessions. Truncating after each test gives the suite
    a central DB isolation contract that does not depend on which session a test used.
    This only covers SQLAlchemy application tables in db.metadata for now;
    object storage and custom ad hoc metadata still need their own cleanup.
    """
    with app.app_context():
        db.session.remove()
        try:
            tables = db.metadata.sorted_tables
            if not tables:
                return

            preparer = db.engine.dialect.identifier_preparer
            table_names = ", ".join(preparer.format_table(table) for table in tables)

            with db.engine.begin() as conn:
                conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                conn.execute(text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"))
        finally:
            db.session.remove()


def _flush_container_redis(app: Flask) -> None:
    """
    Reset Redis after a container integration test.

    Tests in this package share one Redis container for performance. Application
    code stores temporary tokens, rate-limit counters, locks, and cache entries
    there, so flushing after each test gives Redis-backed state the same
    isolation contract as the PostgreSQL container.
    """
    with app.app_context():
        app.extensions["redis"].flushdb()


def _get_container_app_used_by_test(request: pytest.FixtureRequest) -> Flask | None:
    """Return the containerized application fixture already requested by the test."""
    for fixture_name in ("container_app", "container_db_app"):
        if fixture_name not in request.fixturenames:
            continue

        app = request.getfixturevalue(fixture_name)
        assert isinstance(app, Flask)
        return app
    return None


@pytest.fixture(autouse=True)
def isolate_container_database(request: pytest.FixtureRequest) -> Generator[None, None, None]:
    """
    Clean DB and Redis state after tests that use the containerized Flask app.

    This fixture intentionally does not depend on container_app so
    tests under this package do not start the full app/container stack just to
    run state cleanup.
    """
    yield

    app = _get_container_app_used_by_test(request)
    if app is None:
        return

    skip_truncate = request.node.get_closest_marker("no_container_truncate") is not None
    if not skip_truncate:
        _truncate_container_database(app)
    if "redis" in _container_manager.started_services and "redis" in app.extensions:
        _flush_container_redis(app)


@pytest.fixture(scope="package", autouse=True)
def mock_ssrf_proxy_requests() -> Generator[None, None, None]:
    """
    Avoid outbound network during containerized tests by stubbing SSRF proxy helpers.
    """

    from unittest.mock import patch

    import httpx

    def _fake_request(method: str, url: str, **_kwargs: object) -> httpx.Response:
        request = httpx.Request(method=method, url=url)
        return httpx.Response(200, request=request, content=b"")

    with (
        patch("core.helper.ssrf_proxy.make_request", side_effect=_fake_request),
        patch("core.helper.ssrf_proxy.get", side_effect=lambda url, **kw: _fake_request("GET", url, **kw)),
        patch("core.helper.ssrf_proxy.post", side_effect=lambda url, **kw: _fake_request("POST", url, **kw)),
        patch("core.helper.ssrf_proxy.put", side_effect=lambda url, **kw: _fake_request("PUT", url, **kw)),
        patch("core.helper.ssrf_proxy.patch", side_effect=lambda url, **kw: _fake_request("PATCH", url, **kw)),
        patch("core.helper.ssrf_proxy.delete", side_effect=lambda url, **kw: _fake_request("DELETE", url, **kw)),
        patch("core.helper.ssrf_proxy.head", side_effect=lambda url, **kw: _fake_request("HEAD", url, **kw)),
    ):
        yield
