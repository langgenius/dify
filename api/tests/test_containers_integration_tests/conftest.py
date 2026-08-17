"""
TestContainers-based integration test configuration for Dify API.

This module provides containerized test infrastructure using TestContainers library
to spin up real database and service instances for integration testing. This approach
ensures tests run against actual service implementations rather than mocks, providing
more reliable and realistic test scenarios.
"""

import logging
import os
from collections.abc import Generator
from contextlib import ExitStack, closing
from dataclasses import dataclass
from pathlib import Path

import psycopg2
import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session
from testcontainers.core.container import DockerContainer
from testcontainers.core.network import Network
from testcontainers.core.wait_strategies import LogMessageWaitStrategy
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from app_factory import create_app
from extensions.ext_database import db

# Configure logging for test containers
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_SANDBOX_TEST_IMAGE = "langgenius/dify-sandbox:0.2.14"
SANDBOX_TEST_IMAGE_ENV = "DIFY_SANDBOX_TEST_IMAGE"


def _wait_for_log_message(message: str, timeout: int) -> LogMessageWaitStrategy:
    return LogMessageWaitStrategy(message).with_startup_timeout(timeout)


@dataclass(frozen=True, slots=True)
class DifyTestContainerEnvironment:
    postgres: PostgresContainer
    redis: RedisContainer
    dify_sandbox: DockerContainer
    dify_plugin_daemon: DockerContainer | None


@pytest.fixture(scope="session")
def testcontainers_network() -> Generator[Network, None, None]:
    """Provide the shared network after all dependent containers have stopped."""
    logger.info("Creating Docker network for test container communication")
    with Network() as network:
        logger.info("Docker network created successfully with name: %s", network.name)
        yield network


@pytest.fixture(scope="session")
def postgres_container(testcontainers_network: Network) -> Generator[PostgresContainer, None, None]:
    """Provide PostgreSQL and clean it up if any later setup step fails."""
    postgres = PostgresContainer(image="postgres:14-alpine").with_network(testcontainers_network)
    postgres.waiting_for(_wait_for_log_message("is ready to accept connections", 30))

    with ExitStack() as stack:
        postgres = stack.enter_context(postgres)
        environment = stack.enter_context(pytest.MonkeyPatch.context())
        db_host = postgres.get_container_host_ip()
        db_port = postgres.get_exposed_port(5432)
        environment.setenv("DB_HOST", db_host)
        environment.setenv("DB_PORT", str(db_port))
        environment.setenv("DB_USERNAME", postgres.username)
        environment.setenv("DB_PASSWORD", postgres.password)
        environment.setenv("DB_DATABASE", postgres.dbname)

        logger.info(
            "PostgreSQL container started successfully - Host: %s, Port: %s User: %s, Database: %s",
            db_host,
            db_port,
            postgres.username,
            postgres.dbname,
        )

        connection = psycopg2.connect(
            host=db_host,
            port=db_port,
            user=postgres.username,
            password=postgres.password,
            database=postgres.dbname,
        )
        connection.autocommit = True
        with closing(connection):
            with connection.cursor() as cursor:
                cursor.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

            # CREATE DATABASE cannot run inside a transaction block.
            with closing(connection.cursor()) as cursor:
                cursor.execute("CREATE DATABASE dify_plugin;")

        yield postgres


@pytest.fixture(scope="session")
def redis_container(testcontainers_network: Network) -> Generator[RedisContainer, None, None]:
    """Provide Redis with its process environment scoped to the fixture."""
    redis = RedisContainer(image="redis:6-alpine", port=6379).with_network(testcontainers_network)
    redis.waiting_for(_wait_for_log_message("Ready to accept connections", 30))

    with ExitStack() as stack:
        redis = stack.enter_context(redis)
        environment = stack.enter_context(pytest.MonkeyPatch.context())
        redis_host = redis.get_container_host_ip()
        redis_port = redis.get_exposed_port(6379)
        environment.setenv("REDIS_HOST", redis_host)
        environment.setenv("REDIS_PORT", str(redis_port))
        environment.setenv("REDIS_USERNAME", "")
        environment.setenv("REDIS_PASSWORD", "")
        logger.info("Redis container started successfully - Host: %s, Port: %s", redis_host, redis_port)
        yield redis


@pytest.fixture(scope="session")
def dify_sandbox_container(testcontainers_network: Network) -> Generator[DockerContainer, None, None]:
    """Provide Dify Sandbox with its endpoint environment."""
    sandbox_image = os.getenv(SANDBOX_TEST_IMAGE_ENV, DEFAULT_SANDBOX_TEST_IMAGE)
    sandbox = DockerContainer(image=sandbox_image).with_network(testcontainers_network)
    sandbox.with_exposed_ports(8194)
    sandbox.waiting_for(_wait_for_log_message("config init success", 60))
    sandbox.env = {"API_KEY": "test_api_key"}

    with ExitStack() as stack:
        sandbox = stack.enter_context(sandbox)
        environment = stack.enter_context(pytest.MonkeyPatch.context())
        sandbox_host = sandbox.get_container_host_ip()
        sandbox_port = sandbox.get_exposed_port(8194)
        environment.setenv("CODE_EXECUTION_ENDPOINT", f"http://{sandbox_host}:{sandbox_port}")
        environment.setenv("CODE_EXECUTION_API_KEY", "test_api_key")
        logger.info(
            "Dify Sandbox container started successfully - Image: %s Host: %s, Port: %s",
            sandbox_image,
            sandbox_host,
            sandbox_port,
        )
        yield sandbox


@pytest.fixture(scope="session")
def dify_plugin_daemon_container(
    testcontainers_network: Network,
    postgres_container: PostgresContainer,
    redis_container: RedisContainer,
) -> Generator[DockerContainer | None, None, None]:
    """Provide the optional plugin daemon without swallowing consumer failures."""
    postgres_container_name = postgres_container.get_wrapped_container().name
    redis_container_name = redis_container.get_wrapped_container().name
    assert postgres_container_name is not None
    assert redis_container_name is not None

    plugin_daemon = DockerContainer(image="langgenius/dify-plugin-daemon:0.5.3-local").with_network(
        testcontainers_network
    )
    plugin_daemon.with_exposed_ports(5002)
    plugin_daemon.waiting_for(_wait_for_log_message("start plugin manager daemon", 60))
    plugin_daemon.env = {
        "DB_HOST": postgres_container_name,
        "DB_PORT": "5432",
        "DB_USERNAME": postgres_container.username,
        "DB_PASSWORD": postgres_container.password,
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

    stack = ExitStack()
    try:
        plugin_daemon = stack.enter_context(plugin_daemon)
        plugin_daemon_host = plugin_daemon.get_container_host_ip()
        plugin_daemon_port = plugin_daemon.get_exposed_port(5002)
    except Exception:
        logger.exception("Failed to start Dify Plugin Daemon container")
        stack.close()
        logger.info("Continuing without plugin daemon - some tests may be limited")
        yield None
        return

    with stack:
        environment = stack.enter_context(pytest.MonkeyPatch.context())
        environment.setenv("PLUGIN_DAEMON_URL", f"http://{plugin_daemon_host}:{plugin_daemon_port}")
        environment.setenv("PLUGIN_DAEMON_KEY", "test_plugin_daemon_key")
        logger.info(
            "Dify Plugin Daemon container started successfully - Host: %s, Port: %s",
            plugin_daemon_host,
            plugin_daemon_port,
        )
        yield plugin_daemon


@pytest.fixture(scope="session")
def storage_environment() -> Generator[None, None, None]:
    """Provide default storage settings without overwriting caller overrides."""
    defaults = {
        "STORAGE_TYPE": "opendal",
        "OPENDAL_SCHEME": "fs",
        "OPENDAL_FS_ROOT": "/tmp/dify-storage",
    }
    with pytest.MonkeyPatch.context() as environment:
        for name, value in defaults.items():
            if name not in os.environ:
                environment.setenv(name, value)
        yield


def _get_migration_dir() -> Path:
    conftest_dir = Path(__file__).parent
    return conftest_dir.parent.parent / "migrations"


def _get_engine_url(engine: Engine) -> str:
    try:
        return engine.url.render_as_string(hide_password=False).replace("%", "%%")
    except AttributeError:
        return str(engine.url).replace("%", "%%")


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


def _create_app_with_containers() -> Flask:
    """
    Create Flask application configured to use test containers.

    This function creates a Flask application instance that is configured
    to connect to the test containers instead of the default development
    or production databases.

    Returns:
        Flask: Configured Flask application for containerized testing
    """
    logger.info("Creating Flask application with test container configuration...")

    # Ensure Redis client reconnects to the containerized Redis (no auth)
    from extensions import ext_redis

    ext_redis.redis_client._client = None
    # Re-create the config after environment variables have been set
    from configs import dify_config

    # Force re-creation of config with new environment variables
    dify_config.__dict__.clear()
    dify_config.__init__()

    # Create and configure the Flask application
    logger.info("Initializing Flask application...")
    sio_app, app = create_app()
    logger.info("Flask application created successfully")

    # Initialize database schema
    logger.info("Creating database schema...")

    with app.app_context():
        with db.engine.connect() as conn, conn.begin():
            conn.execute(text(_UUIDv7SQL))
        db.create_all()
        # migration_dir = _get_migration_dir()
        # alembic_config = Config()
        # alembic_config.config_file_name = str(migration_dir / "alembic.ini")
        # alembic_config.set_main_option("sqlalchemy.url", _get_engine_url(db.engine))
        # alembic_config.set_main_option("script_location", str(migration_dir))
        # alembic_command.upgrade(revision="head", config=alembic_config)
    logger.info("Database schema created successfully")

    logger.info("Flask application configured and ready for testing")
    return app


@pytest.fixture(scope="session")
def set_up_containers_and_env(
    postgres_container: PostgresContainer,
    redis_container: RedisContainer,
    dify_sandbox_container: DockerContainer,
    dify_plugin_daemon_container: DockerContainer | None,
    storage_environment: None,
) -> DifyTestContainerEnvironment:
    """
    Compose the independently managed test container fixtures.

    Pytest owns the dependency graph and finalizes every resource fixture in
    reverse order, including when a later fixture fails during setup.

    Returns:
        DifyTestContainerEnvironment: Handles for the started containers
    """
    assert storage_environment is None
    logger.info("Test containers ready for session")
    return DifyTestContainerEnvironment(
        postgres=postgres_container,
        redis=redis_container,
        dify_sandbox=dify_sandbox_container,
        dify_plugin_daemon=dify_plugin_daemon_container,
    )


@pytest.fixture(scope="session")
def flask_app_with_containers(set_up_containers_and_env: DifyTestContainerEnvironment) -> Flask:
    """
    Session-scoped Flask application fixture using test containers.

    This fixture provides a Flask application instance that is configured
    to use the test containers for all database and service connections.

    Args:
        set_up_containers_and_env: Composed test container environment

    Returns:
        Flask: Configured Flask application
    """
    assert set_up_containers_and_env.postgres is not None
    logger.info("=== Creating session-scoped Flask application ===")
    app = _create_app_with_containers()
    logger.info("Session-scoped Flask application created successfully")
    return app


@pytest.fixture
def flask_req_ctx_with_containers(flask_app_with_containers: Flask) -> Generator[None, None, None]:
    """
    Request context fixture for containerized Flask application.

    This fixture provides a Flask request context for tests that need
    to interact with the Flask application within a request scope.

    Args:
        flask_app_with_containers: Flask application fixture

    Yields:
        None: Request context is active during yield
    """
    logger.debug("Creating Flask request context...")
    with flask_app_with_containers.test_request_context():
        logger.debug("Flask request context active")
        yield
    logger.debug("Flask request context closed")


@pytest.fixture
def test_client_with_containers(flask_app_with_containers: Flask) -> Generator[FlaskClient, None, None]:
    """
    Test client fixture for containerized Flask application.

    This fixture provides a Flask test client that can be used to make
    HTTP requests to the containerized application for integration testing.

    Args:
        flask_app_with_containers: Flask application fixture

    Yields:
        FlaskClient: Test client instance
    """
    logger.debug("Creating Flask test client...")
    with flask_app_with_containers.test_client() as client:
        logger.debug("Flask test client ready")
        yield client
    logger.debug("Flask test client closed")


@pytest.fixture
def db_session_with_containers(flask_app_with_containers: Flask) -> Generator[Session, None, None]:
    """
    Database session fixture for containerized testing.

    This fixture provides a SQLAlchemy database session that is connected
    to the test PostgreSQL container, allowing tests to interact with
    the database directly.

    Args:
        flask_app_with_containers: Flask application fixture

    Yields:
        Session: Database session instance
    """
    logger.debug("Creating database session...")
    with flask_app_with_containers.app_context():
        session = db.session()
        logger.debug("Database session created and ready")
        try:
            yield session
        finally:
            session.close()
            logger.debug("Database session closed")


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

        tables = db.metadata.sorted_tables
        if not tables:
            return

        preparer = db.engine.dialect.identifier_preparer
        table_names = ", ".join(preparer.format_table(table) for table in tables)

        with db.engine.begin() as conn:
            conn.execute(text("SET LOCAL lock_timeout = '5s'"))
            conn.execute(text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"))

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


@pytest.fixture(autouse=True)
def isolate_container_database(request: pytest.FixtureRequest) -> Generator[None, None, None]:
    """
    Clean DB and Redis state after tests that use the containerized Flask app.

    This fixture intentionally does not depend on flask_app_with_containers so
    tests under this package do not start the full app/container stack just to
    run state cleanup.
    """
    yield

    if "flask_app_with_containers" not in request.fixturenames:
        return

    app = request.getfixturevalue("flask_app_with_containers")
    assert isinstance(app, Flask)
    try:
        _truncate_container_database(app)
    finally:
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
