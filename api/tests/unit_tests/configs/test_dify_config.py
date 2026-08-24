from typing import override

import pytest
from flask import Flask
from packaging.version import Version
from pydantic import SecretStr, ValidationError
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource
from yarl import URL

from configs.app_config import DifyConfig
from configs.feature import OpsTraceConfig
from enums import DeploymentEdition


def test_ops_trace_config_rejects_parent_context_ttl_shorter_than_retry_window() -> None:
    with pytest.raises(ValidationError, match="must cover the retry window"):
        OpsTraceConfig(
            OPS_TRACE_UNIFIED_ENABLED=True,
            OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES=4,
            OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS=5,
            OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS=19,
        )


def test_ops_trace_config_skips_parent_context_validation_when_unified_tracing_is_disabled() -> None:
    OpsTraceConfig(
        OPS_TRACE_UNIFIED_ENABLED=False,
        OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES=4,
        OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS=5,
        OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS=19,
    )


def test_ops_trace_config_accepts_parent_context_ttl_covering_retry_window() -> None:
    OpsTraceConfig(
        OPS_TRACE_UNIFIED_ENABLED=True,
        OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES=4,
        OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS=5,
        OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS=20,
    )


class _IsolatedDifyConfig(DifyConfig):
    """Load explicit test values and packaging metadata without consulting process state."""

    @classmethod
    @override
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        production_sources = super().settings_customise_sources(
            settings_cls,
            init_settings,
            env_settings,
            dotenv_settings,
            file_secret_settings,
        )
        return init_settings, production_sources[-1]


def _make_config(**values: object) -> DifyConfig:
    return _IsolatedDifyConfig(**values)


def test_dify_config_keeps_secret_key_empty_when_missing(tmp_path) -> None:
    config = _make_config(OPENDAL_FS_ROOT=str(tmp_path))

    assert config.SECRET_KEY == ""
    assert not hasattr(config, "OPENDAL_FS_ROOT")
    assert not (tmp_path / ".dify_secret_key").exists()


def test_dify_config_preserves_explicit_secret_key(tmp_path) -> None:
    config = _make_config(SECRET_KEY="explicit", OPENDAL_FS_ROOT=str(tmp_path))

    assert config.SECRET_KEY == "explicit"
    assert not (tmp_path / ".dify_secret_key").exists()


def test_dify_config():
    config = _make_config(
        HTTP_REQUEST_MAX_WRITE_TIMEOUT="30",
        HTTP_REQUEST_MAX_READ_TIMEOUT="300",
    )

    # constant values
    assert config.COMMIT_SHA == ""

    # default values
    assert config.DEPLOYMENT_EDITION is DeploymentEdition.COMMUNITY
    assert config.API_COMPRESSION_ENABLED is False
    assert config.AGENT_SHELL_ENABLED is True
    assert config.SENTRY_TRACES_SAMPLE_RATE == 1.0
    assert config.TEMPLATE_TRANSFORM_MAX_LENGTH == 400_000
    assert config.GRAPH_ENGINE_SCALE_UP_THRESHOLD == 0

    # annotated field with custom configured value
    assert config.HTTP_REQUEST_MAX_READ_TIMEOUT == 300

    # annotated field with custom configured value
    assert config.HTTP_REQUEST_MAX_WRITE_TIMEOUT == 30

    # values from pyproject.toml
    assert Version(config.project.version) >= Version("1.0.0")


@pytest.mark.parametrize(
    ("environment_value", "expected"),
    [
        pytest.param(None, "", id="unset"),
        pytest.param("", "", id="empty"),
        pytest.param("expected", "expected", id="ascii"),
        pytest.param("pässwörd-🔐", "pässwörd-🔐", id="unicode"),
    ],
)
def test_init_password_defaults_to_empty_and_preserves_explicit_value(
    environment_value: str | None,
    expected: str,
) -> None:
    values = {} if environment_value is None else {"INIT_PASSWORD": environment_value}
    config = _make_config(**values)

    assert expected == config.INIT_PASSWORD


@pytest.mark.parametrize("edition", list(DeploymentEdition))
def test_deployment_edition_accepts_every_supported_value(edition: DeploymentEdition) -> None:
    config = _make_config(DEPLOYMENT_EDITION=edition.value)

    assert config.DEPLOYMENT_EDITION is edition


def test_new_user_default_plugin_ids_are_parsed() -> None:
    config = _make_config(
        NEW_USER_DEFAULT_PLUGIN_IDS="langgenius/openai, langgenius/gemini",
    )

    assert config.NEW_USER_DEFAULT_PLUGIN_ID_LIST == [
        "langgenius/openai",
        "langgenius/gemini",
    ]


def test_turnstile_config_is_parsed() -> None:
    config = _make_config(
        TURNSTILE_SECRET_KEY=" test-secret ",
        TURNSTILE_ALLOWED_HOSTNAMES="dify.dev, Login.Example.COM. ",
        TURNSTILE_EMAIL_CODE_VERIFY_REQUIRED="true",
    )

    assert isinstance(config.TURNSTILE_SECRET_KEY, SecretStr)
    assert config.TURNSTILE_SECRET_KEY.get_secret_value() == "test-secret"
    assert frozenset({"dify.dev", "login.example.com"}) == config.TURNSTILE_ALLOWED_HOSTNAME_SET
    assert config.TURNSTILE_EMAIL_CODE_VERIFY_REQUIRED is True


def test_email_code_login_attempt_budget_is_parsed() -> None:
    config = _make_config(EMAIL_CODE_LOGIN_MAX_ATTEMPTS="7")

    assert config.EMAIL_CODE_LOGIN_MAX_ATTEMPTS == 7


def test_plugin_remote_install_port_rejects_host_port_spec() -> None:
    """A 'host:port' compose publish spec must produce an actionable error, not an opaque int_parsing traceback."""
    with pytest.raises(ValueError, match="must be a bare port number"):
        _make_config(PLUGIN_REMOTE_INSTALL_PORT="127.0.0.1:5003")


def test_plugin_remote_install_port_accepts_bare_port() -> None:
    config = _make_config(PLUGIN_REMOTE_INSTALL_PORT="5003")

    assert config.PLUGIN_REMOTE_INSTALL_PORT == 5003


def test_new_user_default_models_are_parsed() -> None:
    config = _make_config(
        NEW_USER_DEFAULT_MODELS=(
            "llm:langgenius/openai/openai:gpt-4o-mini, "
            "text-embedding:langgenius/openai/openai:text-embedding-3-small, "
            "rerank:langgenius/ollama/ollama:reranker:latest"
        ),
    )

    assert config.NEW_USER_DEFAULT_MODEL_LIST == [
        ("llm", "langgenius/openai/openai", "gpt-4o-mini"),
        ("text-embedding", "langgenius/openai/openai", "text-embedding-3-small"),
        ("rerank", "langgenius/ollama/ollama", "reranker:latest"),
    ]


def test_new_user_default_models_reject_duplicate_model_types() -> None:
    config = _make_config(
        NEW_USER_DEFAULT_MODELS=(
            "llm:langgenius/openai/openai:gpt-4o-mini,llm:langgenius/anthropic/anthropic:claude-sonnet-4"
        ),
    )

    with pytest.raises(ValueError, match="duplicate model type: llm"):
        _ = config.NEW_USER_DEFAULT_MODEL_LIST


def test_http_timeout_defaults():
    """Test that HTTP timeout defaults are correctly set"""
    config = _make_config()

    # Verify default timeout values
    assert config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT == 10
    assert config.HTTP_REQUEST_MAX_READ_TIMEOUT == 600
    assert config.HTTP_REQUEST_MAX_WRITE_TIMEOUT == 600


def test_internal_files_url_falls_back_to_server_console_api_url():
    config = _make_config(SERVER_CONSOLE_API_URL="http://api:5001")

    assert config.INTERNAL_FILES_URL == "http://api:5001"


def test_internal_files_url_prefers_explicit_value():
    config = _make_config(
        INTERNAL_FILES_URL="http://files-internal:5001",
        SERVER_CONSOLE_API_URL="http://api:5001",
    )

    assert config.INTERNAL_FILES_URL == "http://files-internal:5001"


def test_empty_files_url_overrides_console_api_url_for_relative_browser_uris():
    config = _make_config(FILES_URL="", CONSOLE_API_URL="http://api:5001")

    assert config.FILES_URL == ""


def test_flask_configs():
    flask_app = Flask("app")
    flask_app.config.from_mapping(
        _make_config(
            CONSOLE_API_URL="https://example.com",
            CONSOLE_WEB_URL="https://example.com",
            DB_TYPE="postgresql",
            DB_USERNAME="postgres",
            DB_PASSWORD="postgres",
            DB_HOST="localhost",
            DB_PORT="5432",
            DB_DATABASE="dify",
            WEB_API_CORS_ALLOW_ORIGINS="http://127.0.0.1:3000,*",
            CODE_EXECUTION_ENDPOINT="http://127.0.0.1:8194/",
        ).model_dump()
    )
    config = flask_app.config

    # configs read from pydantic-settings
    assert config["LOG_LEVEL"] == "INFO"
    assert config["COMMIT_SHA"] == ""
    assert config["DEPLOYMENT_EDITION"] is DeploymentEdition.COMMUNITY
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
        "pool_timeout": 30,
        "pool_reset_on_return": "rollback",
    }

    assert config["CONSOLE_WEB_URL"] == "https://example.com"
    assert config["CONSOLE_CORS_ALLOW_ORIGINS"] == ["https://example.com"]
    assert config["WEB_API_CORS_ALLOW_ORIGINS"] == ["http://127.0.0.1:3000", "*"]

    assert str(config["CODE_EXECUTION_ENDPOINT"]) == "http://127.0.0.1:8194/"
    assert str(URL(str(config["CODE_EXECUTION_ENDPOINT"])) / "v1") == "http://127.0.0.1:8194/v1"


def test_inner_api_config_exist():
    config = _make_config(INNER_API_KEY="test-inner-api-key")
    assert config.INNER_API is False
    assert isinstance(config.INNER_API_KEY, str)
    assert len(config.INNER_API_KEY) > 0


def test_db_extras_options_merging():
    """Test that DB_EXTRAS options are merged with the default timezone startup option."""
    config = _make_config(DB_EXTRAS="options=-c search_path=myschema")

    options = config.SQLALCHEMY_ENGINE_OPTIONS["connect_args"]["options"]
    assert "search_path=myschema" in options
    assert "timezone=UTC" in options


def test_db_session_timezone_override_can_disable_app_level_timezone_injection():
    config = _make_config(
        DB_EXTRAS="options=-c search_path=myschema",
        DB_SESSION_TIMEZONE_OVERRIDE="",
    )

    assert config.SQLALCHEMY_ENGINE_OPTIONS["connect_args"] == {
        "options": "-c search_path=myschema",
    }


def test_pubsub_redis_url_default():
    config = _make_config(
        REDIS_HOST="redis.example.com",
        REDIS_PORT="6380",
        REDIS_USERNAME="user",
        REDIS_PASSWORD="pass@word",
        REDIS_DB="2",
        REDIS_USE_SSL="true",
    )

    assert config.normalized_pubsub_redis_url == "rediss://user:pass%40word@redis.example.com:6380/2"
    assert config.PUBSUB_REDIS_CHANNEL_TYPE == "pubsub"


def test_pubsub_redis_url_override():
    config = _make_config(PUBSUB_REDIS_URL="redis://pubsub-host:6381/5")

    assert config.normalized_pubsub_redis_url == "redis://pubsub-host:6381/5"


def test_pubsub_redis_url_required_when_default_unavailable():
    config = _make_config(REDIS_HOST="")
    with pytest.raises(ValueError, match="PUBSUB_REDIS_URL must be set"):
        _ = config.normalized_pubsub_redis_url


def test_dify_config_exposes_redis_key_prefix_default():
    config = _make_config()

    assert config.REDIS_KEY_PREFIX == ""


def test_dify_config_accepts_redis_key_prefix():
    config = _make_config(REDIS_KEY_PREFIX="enterprise-a")

    assert config.REDIS_KEY_PREFIX == "enterprise-a"


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
    broker_url,
    expected_host,
    expected_port,
    expected_username,
    expected_password,
    expected_db,
):
    """Test that CELERY_BROKER_URL with various formats are handled correctly."""
    from kombu.utils.url import parse_url

    config = _make_config(CELERY_BROKER_URL=broker_url)
    assert broker_url == config.CELERY_BROKER_URL

    # Test actual parsing behavior using kombu's parse_url (same as production)
    redis_config = parse_url(config.CELERY_BROKER_URL)

    # Verify the parsing results match expectations (using kombu's field names)
    assert redis_config["hostname"] == expected_host
    assert redis_config["port"] == expected_port
    assert redis_config["userid"] == expected_username  # kombu uses 'userid' not 'username'
    assert redis_config["password"] == expected_password
    assert redis_config["virtual_host"] == expected_db  # kombu uses 'virtual_host' not 'db'
