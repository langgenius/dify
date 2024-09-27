import os
from textwrap import dedent

import pytest
from flask import Flask
from yarl import URL

from configs.app_config import DifyConfig

EXAMPLE_ENV_FILENAME = ".env"


@pytest.fixture()
def example_env_file(tmp_path, monkeypatch) -> str:
    monkeypatch.chdir(tmp_path)
    file_path = tmp_path.joinpath(EXAMPLE_ENV_FILENAME)
    file_path.write_text(
        dedent(
            """
        CONSOLE_API_URL=https://example.com
        CONSOLE_WEB_URL=https://example.com
        HTTP_REQUEST_MAX_WRITE_TIMEOUT=30
        """
        )
    )
    return str(file_path)


def test_dify_config_undefined_entry(example_env_file):
    # NOTE: See https://github.com/microsoft/pylance-release/issues/6099 for more details about this type error.
    # load dotenv file with pydantic-settings
    config = DifyConfig(_env_file=example_env_file)

    # entries not defined in app settings
    with pytest.raises(TypeError):
        # TypeError: 'AppSettings' object is not subscriptable
        assert config["LOG_LEVEL"] == "INFO"


def test_dify_config(example_env_file):
    # load dotenv file with pydantic-settings
    config = DifyConfig(_env_file=example_env_file)

    # constant values
    assert config.COMMIT_SHA == ""

    # default values
    assert config.EDITION == "SELF_HOSTED"
    assert config.API_COMPRESSION_ENABLED is False
    assert config.SENTRY_TRACES_SAMPLE_RATE == 1.0

    # annotated field with default value
    assert config.HTTP_REQUEST_MAX_READ_TIMEOUT == 60

    # annotated field with configured value
    assert config.HTTP_REQUEST_MAX_WRITE_TIMEOUT == 30


# NOTE: If there is a `.env` file in your Workspace, this test might not succeed as expected.
# This is due to `pymilvus` loading all the variables from the `.env` file into `os.environ`.
def test_flask_configs(example_env_file):
    flask_app = Flask("app")
    # clear system environment variables
    os.environ.clear()
    flask_app.config.from_mapping(DifyConfig(_env_file=example_env_file).model_dump())  # pyright: ignore
    config = flask_app.config

    # configs read from pydantic-settings
    assert config["LOG_LEVEL"] == "INFO"
    assert config["COMMIT_SHA"] == ""
    assert config["EDITION"] == "SELF_HOSTED"
    assert config["API_COMPRESSION_ENABLED"] is False
    assert config["SENTRY_TRACES_SAMPLE_RATE"] == 1.0
    assert config["TESTING"] == False

    # value from env file
    assert config["CONSOLE_API_URL"] == "https://example.com"
    # fallback to alias choices value as CONSOLE_API_URL
    assert config["FILES_URL"] == "https://example.com"

    assert config["SQLALCHEMY_DATABASE_URI"] == "postgresql://postgres:@localhost:5432/dify"
    assert config["SQLALCHEMY_ENGINE_OPTIONS"] == {
        "connect_args": {
            "options": "-c timezone=UTC",
        },
        "max_overflow": 10,
        "pool_pre_ping": False,
        "pool_recycle": 3600,
        "pool_size": 30,
    }

    assert config["CONSOLE_WEB_URL"] == "https://example.com"
    assert config["CONSOLE_CORS_ALLOW_ORIGINS"] == ["https://example.com"]
    assert config["WEB_API_CORS_ALLOW_ORIGINS"] == ["*"]

    assert str(config["CODE_EXECUTION_ENDPOINT"]) == "http://sandbox:8194/"
    assert str(URL(str(config["CODE_EXECUTION_ENDPOINT"])) / "v1") == "http://sandbox:8194/v1"
