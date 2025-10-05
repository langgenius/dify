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
from pathlib import Path

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session
from testcontainers.core.container import DockerContainer
from testcontainers.core.network import Network
from testcontainers.core.waiting_utils import wait_for_logs
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from app_factory import create_app
from extensions.ext_database import db

# Configure logging for test containers
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class DifyTestContainers:
    """
    Manages all test containers required for Dify integration tests.

    This class provides a centralized way to manage multiple containers
    needed for comprehensive integration testing, including databases,
    caches, and search engines.
    """

    def __init__(self):
        """Initialize container management with default configurations."""
        self.network: Network | None = None
        self.postgres: PostgresContainer | None = None
        self.redis: RedisContainer | None = None
        self.dify_sandbox: DockerContainer | None = None
        self.dify_plugin_daemon: DockerContainer | None = None
        self._containers_started = False
        logger.info("DifyTestContainers initialized - ready to manage test containers")

    def start_containers_with_env(self):
        """
        Start all required containers for integration testing.

        This method initializes and starts PostgreSQL, Redis
        containers with appropriate configurations for Dify testing. Containers
        are started in dependency order to ensure proper initialization.
        """
        if self._containers_started:
            logger.info("Containers already started - skipping container startup")
            return

        logger.info("Starting test containers for Dify integration tests...")

        # Create Docker network for container communication
        logger.info("Creating Docker network for container communication...")
        self.network = Network()
        self.network.create()
        logger.info("Docker network created successfully with name: %s", self.network.name)

        # Start PostgreSQL container for main application database
        # PostgreSQL is used for storing user data, workflows, and application state
        logger.info("Initializing PostgreSQL container...")
        self.postgres = PostgresContainer(
            image="postgres:14-alpine",
        ).with_network(self.network)
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

        # Wait for PostgreSQL to be ready
        logger.info("Waiting for PostgreSQL to be ready to accept connections...")
        wait_for_logs(self.postgres, "is ready to accept connections", timeout=30)
        logger.info("PostgreSQL container is ready and accepting connections")

        # Install uuid-ossp extension for UUID generation
        logger.info("Installing uuid-ossp extension...")
        try:
            import psycopg2

            conn = psycopg2.connect(
                host=db_host,
                port=db_port,
                user=self.postgres.username,
                password=self.postgres.password,
                database=self.postgres.dbname,
            )
            conn.autocommit = True
            cursor = conn.cursor()
            cursor.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
            cursor.close()
            conn.close()
            logger.info("uuid-ossp extension installed successfully")
        except Exception as e:
            logger.warning("Failed to install uuid-ossp extension: %s", e)

        # Create plugin database for dify-plugin-daemon
        logger.info("Creating plugin database...")
        try:
            conn = psycopg2.connect(
                host=db_host,
                port=db_port,
                user=self.postgres.username,
                password=self.postgres.password,
                database=self.postgres.dbname,
            )
            conn.autocommit = True
            cursor = conn.cursor()
            cursor.execute("CREATE DATABASE dify_plugin;")
            cursor.close()
            conn.close()
            logger.info("Plugin database created successfully")
        except Exception as e:
            logger.warning("Failed to create plugin database: %s", e)

        # Set up storage environment variables
        os.environ["STORAGE_TYPE"] = "opendal"
        os.environ["OPENDAL_SCHEME"] = "fs"
        os.environ["OPENDAL_FS_ROOT"] = "storage"

        # Start Redis container for caching and session management
        # Redis is used for storing session data, cache entries, and temporary data
        logger.info("Initializing Redis container...")
        self.redis = RedisContainer(image="redis:6-alpine", port=6379).with_network(self.network)
        self.redis.start()
        redis_host = self.redis.get_container_host_ip()
        redis_port = self.redis.get_exposed_port(6379)
        os.environ["REDIS_HOST"] = redis_host
        os.environ["REDIS_PORT"] = str(redis_port)
        logger.info("Redis container started successfully - Host: %s, Port: %s", redis_host, redis_port)

        # Wait for Redis to be ready
        logger.info("Waiting for Redis to be ready to accept connections...")
        wait_for_logs(self.redis, "Ready to accept connections", timeout=30)
        logger.info("Redis container is ready and accepting connections")

        # Start Dify Sandbox container for code execution environment
        # Dify Sandbox provides a secure environment for executing user code
        logger.info("Initializing Dify Sandbox container...")
        self.dify_sandbox = DockerContainer(image="langgenius/dify-sandbox:latest").with_network(self.network)
        self.dify_sandbox.with_exposed_ports(8194)
        self.dify_sandbox.env = {
            "API_KEY": "test_api_key",
        }
        self.dify_sandbox.start()
        sandbox_host = self.dify_sandbox.get_container_host_ip()
        sandbox_port = self.dify_sandbox.get_exposed_port(8194)
        os.environ["CODE_EXECUTION_ENDPOINT"] = f"http://{sandbox_host}:{sandbox_port}"
        os.environ["CODE_EXECUTION_API_KEY"] = "test_api_key"
        logger.info("Dify Sandbox container started successfully - Host: %s, Port: %s", sandbox_host, sandbox_port)

        # Wait for Dify Sandbox to be ready
        logger.info("Waiting for Dify Sandbox to be ready to accept connections...")
        wait_for_logs(self.dify_sandbox, "config init success", timeout=60)
        logger.info("Dify Sandbox container is ready and accepting connections")

        # Start Dify Plugin Daemon container for plugin management
        # Dify Plugin Daemon provides plugin lifecycle management and execution
        logger.info("Initializing Dify Plugin Daemon container...")
        self.dify_plugin_daemon = DockerContainer(image="langgenius/dify-plugin-daemon:0.3.0-local").with_network(
            self.network
        )
        self.dify_plugin_daemon.with_exposed_ports(5002)
        # Get container internal network addresses
        postgres_container_name = self.postgres.get_wrapped_container().name
        redis_container_name = self.redis.get_wrapped_container().name

        self.dify_plugin_daemon.env = {
            "DB_HOST": postgres_container_name,  # Use container name for internal network communication
            "DB_PORT": "5432",  # Use internal port
            "DB_USERNAME": self.postgres.username,
            "DB_PASSWORD": self.postgres.password,
            "DB_DATABASE": "dify_plugin",
            "REDIS_HOST": redis_container_name,  # Use container name for internal network communication
            "REDIS_PORT": "6379",  # Use internal port
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

        try:
            self.dify_plugin_daemon.start()
            plugin_daemon_host = self.dify_plugin_daemon.get_container_host_ip()
            plugin_daemon_port = self.dify_plugin_daemon.get_exposed_port(5002)
            os.environ["PLUGIN_DAEMON_URL"] = f"http://{plugin_daemon_host}:{plugin_daemon_port}"
            os.environ["PLUGIN_DAEMON_KEY"] = "test_plugin_daemon_key"
            logger.info(
                "Dify Plugin Daemon container started successfully - Host: %s, Port: %s",
                plugin_daemon_host,
                plugin_daemon_port,
            )

            # Wait for Dify Plugin Daemon to be ready
            logger.info("Waiting for Dify Plugin Daemon to be ready to accept connections...")
            wait_for_logs(self.dify_plugin_daemon, "start plugin manager daemon", timeout=60)
            logger.info("Dify Plugin Daemon container is ready and accepting connections")
        except Exception as e:
            logger.warning("Failed to start Dify Plugin Daemon container: %s", e)
            logger.info("Continuing without plugin daemon - some tests may be limited")
            self.dify_plugin_daemon = None

        self._containers_started = True
        logger.info("All test containers started successfully")

    def stop_containers(self):
        """
        Stop and clean up all test containers.

        This method ensures proper cleanup of all containers to prevent
        resource leaks and conflicts between test runs.
        """
        if not self._containers_started:
            logger.info("No containers to stop - containers were not started")
            return

        logger.info("Stopping and cleaning up test containers...")
        containers = [self.redis, self.postgres, self.dify_sandbox, self.dify_plugin_daemon]
        for container in containers:
            if container:
                try:
                    container_name = container.image
                    logger.info("Stopping container: %s", container_name)
                    container.stop()
                    logger.info("Successfully stopped container: %s", container_name)
                except Exception as e:
                    # Log error but don't fail the test cleanup
                    logger.warning("Failed to stop container %s: %s", container, e)

        # Stop and remove the network
        if self.network:
            try:
                logger.info("Removing Docker network...")
                self.network.remove()
                logger.info("Successfully removed Docker network")
            except Exception as e:
                logger.warning("Failed to remove Docker network: %s", e)

        self._containers_started = False
        logger.info("All test containers stopped and cleaned up successfully")


# Global container manager instance
_container_manager = DifyTestContainers()


def _get_migration_dir() -> Path:
    conftest_dir = Path(__file__).parent
    return conftest_dir.parent.parent / "migrations"


def _get_engine_url(engine: Engine):
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

    # Re-create the config after environment variables have been set
    from configs import dify_config

    # Force re-creation of config with new environment variables
    dify_config.__dict__.clear()
    dify_config.__init__()

    # Create and configure the Flask application
    logger.info("Initializing Flask application...")
    app = create_app()
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
def set_up_containers_and_env() -> Generator[DifyTestContainers, None, None]:
    """
    Session-scoped fixture to manage test containers.

    This fixture ensures containers are started once per test session
    and properly cleaned up when all tests are complete. This approach
    improves test performance by reusing containers across multiple tests.

    Yields:
        DifyTestContainers: Container manager instance
    """
    logger.info("=== Starting test session container management ===")
    _container_manager.start_containers_with_env()
    logger.info("Test containers ready for session")
    yield _container_manager
    logger.info("=== Cleaning up test session containers ===")
    _container_manager.stop_containers()
    logger.info("Test session container cleanup completed")


@pytest.fixture(scope="session")
def flask_app_with_containers(set_up_containers_and_env) -> Flask:
    """
    Session-scoped Flask application fixture using test containers.

    This fixture provides a Flask application instance that is configured
    to use the test containers for all database and service connections.

    Args:
        containers: Container manager fixture

    Returns:
        Flask: Configured Flask application
    """
    logger.info("=== Creating session-scoped Flask application ===")
    app = _create_app_with_containers()
    logger.info("Session-scoped Flask application created successfully")
    return app


@pytest.fixture
def flask_req_ctx_with_containers(flask_app_with_containers) -> Generator[None, None, None]:
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
def test_client_with_containers(flask_app_with_containers) -> Generator[FlaskClient, None, None]:
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
def db_session_with_containers(flask_app_with_containers) -> Generator[Session, None, None]:
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
