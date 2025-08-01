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
from typing import Optional

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session
from testcontainers.core.container import DockerContainer
from testcontainers.core.waiting_utils import wait_for_logs
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from app_factory import create_app
from models import db

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
        self.postgres: Optional[PostgresContainer] = None
        self.redis: Optional[RedisContainer] = None
        self.dify_sandbox: Optional[DockerContainer] = None
        self._containers_started = False
        logger.info("DifyTestContainers initialized - ready to manage test containers")

    def start_containers_with_env(self) -> None:
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

        # Start PostgreSQL container for main application database
        # PostgreSQL is used for storing user data, workflows, and application state
        logger.info("Initializing PostgreSQL container...")
        self.postgres = PostgresContainer(
            image="postgres:16-alpine",
        )
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

        # Set up storage environment variables
        os.environ["STORAGE_TYPE"] = "opendal"
        os.environ["OPENDAL_SCHEME"] = "fs"
        os.environ["OPENDAL_FS_ROOT"] = "storage"

        # Start Redis container for caching and session management
        # Redis is used for storing session data, cache entries, and temporary data
        logger.info("Initializing Redis container...")
        self.redis = RedisContainer(image="redis:latest", port=6379)
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
        self.dify_sandbox = DockerContainer(image="langgenius/dify-sandbox:latest")
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

        self._containers_started = True
        logger.info("All test containers started successfully")

    def stop_containers(self) -> None:
        """
        Stop and clean up all test containers.

        This method ensures proper cleanup of all containers to prevent
        resource leaks and conflicts between test runs.
        """
        if not self._containers_started:
            logger.info("No containers to stop - containers were not started")
            return

        logger.info("Stopping and cleaning up test containers...")
        containers = [self.redis, self.postgres, self.dify_sandbox]
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

        self._containers_started = False
        logger.info("All test containers stopped and cleaned up successfully")


# Global container manager instance
_container_manager = DifyTestContainers()


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
        db.create_all()
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
