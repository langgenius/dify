from textwrap import dedent

import pytest
from flask import Flask

from configs.app_configs import DifyConfigs

EXAMPLE_ENV_FILENAME = '.env'


@pytest.fixture
def example_env_file(tmp_path, monkeypatch) -> str:
    monkeypatch.chdir(tmp_path)
    file_path = tmp_path.joinpath(EXAMPLE_ENV_FILENAME)
    file_path.write_text(dedent(
        """
        CONSOLE_API_URL=https://example.com
        """))
    return str(file_path)


def test_dify_configs_undefined_entry(example_env_file):
    # load dotenv file with pydantic-settings
    settings = DifyConfigs(_env_file=example_env_file)

    # entries not defined in app settings
    with pytest.raises(TypeError):
        # TypeError: 'AppSettings' object is not subscriptable
        assert settings['LOG_LEVEL'] == 'INFO'


def test_dify_configs(example_env_file):
    # load dotenv file with pydantic-settings
    settings = DifyConfigs(_env_file=example_env_file)

    # constant values
    assert settings.COMMIT_SHA == ''

    # default values
    assert settings.EDITION == 'SELF_HOSTED'
    assert settings.API_COMPRESSION_ENABLED is False
    assert settings.SENTRY_TRACES_SAMPLE_RATE == 1.0


def test_flask_configs(example_env_file):
    flask_app = Flask('app')
    flask_app.config.from_mapping(DifyConfigs(_env_file=example_env_file).model_dump())
    config = flask_app.config

    # configs read from dotenv directly
    assert config['LOG_LEVEL'] == 'INFO'

    # configs read from pydantic-settings
    assert config['COMMIT_SHA'] == ''
    assert config['EDITION'] == 'SELF_HOSTED'
    assert config['API_COMPRESSION_ENABLED'] is False
    assert config['SENTRY_TRACES_SAMPLE_RATE'] == 1.0

    # value from env file
    assert config['CONSOLE_API_URL'] == 'https://example.com'
    # fallback to alias choices value as CONSOLE_API_URL
    assert config['FILES_URL'] == 'https://example.com'
