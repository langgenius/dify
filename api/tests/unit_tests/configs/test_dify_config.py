import os

import pytest
from flask import Flask
from packaging.version import Version
from yarl import URL

from configs.app_config import DifyConfig


def test_dify_config(monkeypatch: pytest.MonkeyPatch):
    # clear system environment variables
    os.environ.clear()

    # Set environment variables using monkeypatch
    monkeypatch.setenv("CONSOLE_API_URL", "https://example.com")
    monkeypatch.setenv("CONSOLE_WEB_URL", "https://example.com")
    monkeypatch.setenv("HTTP_REQUEST_MAX_WRITE_TIMEOUT", "30")  # Custom value for testing
    monkeypatch.setenv("DB_TYPE", "postgresql")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "postgres")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "dify")
    monkeypatch.setenv("HTTP_REQUEST_MAX_READ_TIMEOUT", "300")  # Custom value for testing

    # load dotenv file with pydantic-settings
    config = DifyConfig()

    # constant values
    assert config.COMMIT_SHA == ""

    # default values
    assert config.EDITION == "SELF_HOSTED"
    assert config.API_COMPRESSION_ENABLED is False
    assert config.SENTRY_TRACES_SAMPLE_RATE == 1.0
    assert config.TEMPLATE_TRANSFORM_MAX_LENGTH == 400_000

    # annotated field with custom configured value
    assert config.HTTP_REQUEST_MAX_READ_TIMEOUT == 300

    # annotated field with custom configured value
    assert config.HTTP_REQUEST_MAX_WRITE_TIMEOUT == 30

    # values from pyproject.toml
    assert Version(config.project.version) >= Version("1.0.0")


def test_http_timeout_defaults(monkeypatch: pytest.MonkeyPatch):
    """Test that HTTP timeout defaults are correctly set"""
    # clear system environment variables
    os.environ.clear()

    # Set minimal required env vars
    monkeypatch.setenv("DB_TYPE", "postgresql")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "postgres")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "dify")

    config = DifyConfig()

    # Verify default timeout values
    assert config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT == 10
    assert config.HTTP_REQUEST_MAX_READ_TIMEOUT == 600
    assert config.HTTP_REQUEST_MAX_WRITE_TIMEOUT == 600


# NOTE: If there is a `.env` file in your Workspace, this test might not succeed as expected.
# This is due to `pymilvus` loading all the variables from the `.env` file into `os.environ`.
def test_flask_configs(monkeypatch: pytest.MonkeyPatch):
    flask_app = Flask("app")
    # clear system environment variables
    os.environ.clear()

    # Set environment variables using monkeypatch
    monkeypatch.setenv("CONSOLE_API_URL", "https://example.com")
    monkeypatch.setenv("CONSOLE_WEB_URL", "https://example.com")
    monkeypatch.setenv("DB_TYPE", "postgresql")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "postgres")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "dify")
    monkeypatch.setenv("WEB_API_CORS_ALLOW_ORIGINS", "http://127.0.0.1:3000,*")
    monkeypatch.setenv("CODE_EXECUTION_ENDPOINT", "http://127.0.0.1:8194/")

    flask_app.config.from_mapping(DifyConfig().model_dump())  # pyright: ignore
    config = flask_app.config

    # configs read from pydantic-settings
    assert config["LOG_LEVEL"] == "INFO"
    assert config["COMMIT_SHA"] == ""
    assert config["EDITION"] == "SELF_HOSTED"
    assert config["API_COMPRESSION_ENABLED"] is False
    assert config["SENTRY_TRACES_SAMPLE_RATE"] == 1.0

    # value from env file
    assert config["CONSOLE_API_URL"] == "https://example.com"
    # fallback to alias choices value as CONSOLE_API_URL
    assert config["FILES_URL"] == "https://example.com"

    assert config["SQLALCHEMY_DATABASE_URI"] == "postgresql://postgres:postgres@localhost:5432/dify"
    assert config["SQLALCHEMY_ENGINE_OPTIONS"] == {
        "connect_args": {
            "options": "-c timezone=UTC",
        },
        "max_overflow": 10,
        "pool_pre_ping": False,
        "pool_recycle": 3600,
        "pool_size": 30,
        "pool_use_lifo": False,
        "pool_reset_on_return": None,
        "pool_timeout": 30,
    }

    assert config["CONSOLE_WEB_URL"] == "https://example.com"
    assert config["CONSOLE_CORS_ALLOW_ORIGINS"] == ["https://example.com"]
    assert config["WEB_API_CORS_ALLOW_ORIGINS"] == ["http://127.0.0.1:3000", "*"]

    assert str(config["CODE_EXECUTION_ENDPOINT"]) == "http://127.0.0.1:8194/"
    assert str(URL(str(config["CODE_EXECUTION_ENDPOINT"])) / "v1") == "http://127.0.0.1:8194/v1"


def test_inner_api_config_exist(monkeypatch: pytest.MonkeyPatch):
    # Set environment variables using monkeypatch
    monkeypatch.setenv("CONSOLE_API_URL", "https://example.com")
    monkeypatch.setenv("CONSOLE_WEB_URL", "https://example.com")
    monkeypatch.setenv("DB_TYPE", "postgresql")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "postgres")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "dify")
    monkeypatch.setenv("INNER_API_KEY", "test-inner-api-key")

    config = DifyConfig()
    assert config.INNER_API is False
    assert isinstance(config.INNER_API_KEY, str)
    assert len(config.INNER_API_KEY) > 0


def test_db_extras_options_merging(monkeypatch: pytest.MonkeyPatch):
    """Test that DB_EXTRAS options are properly merged with default timezone setting"""
    # Set environment variables
    monkeypatch.setenv("DB_TYPE", "postgresql")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "postgres")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "dify")
    monkeypatch.setenv("DB_EXTRAS", "options=-c search_path=myschema")

    # Create config
    config = DifyConfig()

    # Get engine options
    engine_options = config.SQLALCHEMY_ENGINE_OPTIONS

    # Verify options contains both search_path and timezone
    options = engine_options["connect_args"]["options"]
    assert "search_path=myschema" in options
    assert "timezone=UTC" in options


@pytest.mark.parametrize(
    ("broker_url", "expected_host", "expected_port", "expected_username", "expected_password", "expected_db"),
    [
        ("redis://localhost:6379/1", "localhost", 6379, None, None, "1"),
        ("redis://:password@localhost:6379/1", "localhost", 6379, None, "password", "1"),
        ("redis://:mypass%23123@localhost:6379/1", "localhost", 6379, None, "mypass#123", "1"),
        ("redis://user:pass%40word@redis-host:6380/2", "redis-host", 6380, "user", "pass@word", "2"),
        ("redis://admin:complex%23pass%40word@127.0.0.1:6379/0", "127.0.0.1", 6379, "admin", "complex#pass@word", "0"),
        (
            "redis://user%40domain:secret%23123@redis.example.com:6380/3",
            "redis.example.com",
            6380,
            "user@domain",
            "secret#123",
            "3",
        ),
        # Password containing %23 substring (double encoding scenario)
        ("redis://:mypass%2523@localhost:6379/1", "localhost", 6379, None, "mypass%23", "1"),
        # Username and password both containing encoded characters
        ("redis://user%2525%40:pass%2523@localhost:6379/1", "localhost", 6379, "user%25@", "pass%23", "1"),
    ],
)
def test_celery_broker_url_with_special_chars_password(
    monkeypatch: pytest.MonkeyPatch,
    broker_url,
    expected_host,
    expected_port,
    expected_username,
    expected_password,
    expected_db,
):
    """Test that CELERY_BROKER_URL with various formats are handled correctly."""
    from kombu.utils.url import parse_url

    # clear system environment variables
    os.environ.clear()

    # Set up basic required environment variables (following existing pattern)
    monkeypatch.setenv("CONSOLE_API_URL", "https://example.com")
    monkeypatch.setenv("CONSOLE_WEB_URL", "https://example.com")
    monkeypatch.setenv("DB_TYPE", "postgresql")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "postgres")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "dify")

    # Set the CELERY_BROKER_URL to test
    monkeypatch.setenv("CELERY_BROKER_URL", broker_url)

    # Create config and verify the URL is stored correctly
    config = DifyConfig()
    assert broker_url == config.CELERY_BROKER_URL

    # Test actual parsing behavior using kombu's parse_url (same as production)
    redis_config = parse_url(config.CELERY_BROKER_URL)

    # Verify the parsing results match expectations (using kombu's field names)
    assert redis_config["hostname"] == expected_host
    assert redis_config["port"] == expected_port
    assert redis_config["userid"] == expected_username  # kombu uses 'userid' not 'username'
    assert redis_config["password"] == expected_password
    assert redis_config["virtual_host"] == expected_db  # kombu uses 'virtual_host' not 'db'
