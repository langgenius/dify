import os

from flask import Flask
from packaging.version import Version
from yarl import URL

from configs.app_config import DifyConfig


def test_dify_config(monkeypatch):
    # clear system environment variables
    os.environ.clear()

    # Set environment variables using monkeypatch
    monkeypatch.setenv("CONSOLE_API_URL", "https://example.com")
    monkeypatch.setenv("CONSOLE_WEB_URL", "https://example.com")
    monkeypatch.setenv("HTTP_REQUEST_MAX_WRITE_TIMEOUT", "30")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "postgres")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "dify")
    monkeypatch.setenv("HTTP_REQUEST_MAX_READ_TIMEOUT", "600")

    # load dotenv file with pydantic-settings
    config = DifyConfig()

    # constant values
    assert config.COMMIT_SHA == ""

    # default values
    assert config.EDITION == "SELF_HOSTED"
    assert config.API_COMPRESSION_ENABLED is False
    assert config.SENTRY_TRACES_SAMPLE_RATE == 1.0

    # annotated field with default value
    assert config.HTTP_REQUEST_MAX_READ_TIMEOUT == 600

    # annotated field with configured value
    assert config.HTTP_REQUEST_MAX_WRITE_TIMEOUT == 30

    assert config.WORKFLOW_PARALLEL_DEPTH_LIMIT == 3

    # values from pyproject.toml
    assert Version(config.project.version) >= Version("1.0.0")


# NOTE: If there is a `.env` file in your Workspace, this test might not succeed as expected.
# This is due to `pymilvus` loading all the variables from the `.env` file into `os.environ`.
def test_flask_configs(monkeypatch):
    flask_app = Flask("app")
    # clear system environment variables
    os.environ.clear()

    # Set environment variables using monkeypatch
    monkeypatch.setenv("CONSOLE_API_URL", "https://example.com")
    monkeypatch.setenv("CONSOLE_WEB_URL", "https://example.com")
    monkeypatch.setenv("HTTP_REQUEST_MAX_WRITE_TIMEOUT", "30")
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
    }

    assert config["CONSOLE_WEB_URL"] == "https://example.com"
    assert config["CONSOLE_CORS_ALLOW_ORIGINS"] == ["https://example.com"]
    assert config["WEB_API_CORS_ALLOW_ORIGINS"] == ["http://127.0.0.1:3000", "*"]

    assert str(config["CODE_EXECUTION_ENDPOINT"]) == "http://127.0.0.1:8194/"
    assert str(URL(str(config["CODE_EXECUTION_ENDPOINT"])) / "v1") == "http://127.0.0.1:8194/v1"


def test_inner_api_config_exist(monkeypatch):
    # Set environment variables using monkeypatch
    monkeypatch.setenv("CONSOLE_API_URL", "https://example.com")
    monkeypatch.setenv("CONSOLE_WEB_URL", "https://example.com")
    monkeypatch.setenv("HTTP_REQUEST_MAX_WRITE_TIMEOUT", "30")
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


def test_db_extras_options_merging(monkeypatch):
    """Test that DB_EXTRAS options are properly merged with default timezone setting"""
    # Set environment variables
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
