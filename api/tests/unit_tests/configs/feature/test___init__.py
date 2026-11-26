from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from engineio import Server, WSGIApp
from flask import Flask
from flask_cors import CORS
from pydantic import ValidationError
from werkzeug.test import Client
from werkzeug.wrappers import Response

import configs.feature as feature_config
from configs.feature import AuthConfig, DataSetConfig, FileUploadConfig, HttpConfig, LoggingConfig
from tests.helpers.unit.configs._isolated_settings import InitSettingsOnly


@pytest.mark.parametrize(
    "setting",
    ["CONSOLE_CORS_ALLOW_ORIGINS", "WEB_API_CORS_ALLOW_ORIGINS", "OPENAPI_CORS_ALLOW_ORIGINS"],
)
def test_cors_origins_with_surrounding_whitespace_allow_preflight(setting: str) -> None:
    """Configured comma-separated origins work with Flask-CORS while other origins remain denied."""
    config = HttpConfig.model_validate({setting: " https://first.example ,\t https://second.example \n, "})
    app = Flask(__name__)
    CORS(app, resources={r"/*": {"origins": getattr(config, setting)}}, supports_credentials=True)

    @app.get("/resource")
    def resource() -> str:
        """Serve a resource whose automatic OPTIONS response uses the configured CORS policy."""
        return "ok"

    client = app.test_client()
    for origin in ("https://first.example", "https://second.example"):
        response = client.options("/resource", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        assert response.status_code == 200
        assert response.headers.get("Access-Control-Allow-Origin") == origin
        assert response.headers.get("Access-Control-Allow-Credentials") == "true"

    rejected = client.options(
        "/resource", headers={"Origin": "https://unlisted.example", "Access-Control-Request-Method": "GET"}
    )
    assert "Access-Control-Allow-Origin" not in rejected.headers


@pytest.mark.parametrize("configured", ["", " , \t, ", " \t "])
def test_empty_console_origins_keep_socketio_origin_checks(configured: str) -> None:
    """Blank console configuration must not become Socket.IO's CORS-disabled empty list."""
    config = HttpConfig.model_validate({"CONSOLE_CORS_ALLOW_ORIGINS": configured})
    server = Server(async_mode="threading", cors_allowed_origins=config.CONSOLE_CORS_ALLOW_ORIGINS)
    client = Client(WSGIApp(server), Response)
    try:
        response = client.get("/engine.io/?EIO=4&transport=polling", headers={"Origin": "https://unlisted.example"})
        assert response.status_code == 400
    finally:
        server.shutdown()


class _IsolatedAuthConfig(InitSettingsOnly, AuthConfig):
    pass


class _IsolatedDataSetConfig(InitSettingsOnly, DataSetConfig):
    pass


def test_dataset_description_max_length_defaults_to_400() -> None:
    assert _IsolatedDataSetConfig().DATASET_DESCRIPTION_MAX_LENGTH == 400


@pytest.mark.parametrize("limit", [100, 2000])
def test_dataset_description_max_length_reads_environment(monkeypatch: pytest.MonkeyPatch, limit: int) -> None:
    monkeypatch.setenv("DATASET_DESCRIPTION_MAX_LENGTH", str(limit))

    config = DataSetConfig(_env_file=None)
    assert limit == config.DATASET_DESCRIPTION_MAX_LENGTH


@pytest.mark.parametrize("limit", ["0", "-1", "invalid"])
def test_dataset_description_max_length_rejects_invalid_environment(
    monkeypatch: pytest.MonkeyPatch, limit: str
) -> None:
    monkeypatch.setenv("DATASET_DESCRIPTION_MAX_LENGTH", limit)

    with pytest.raises(ValidationError, match="DATASET_DESCRIPTION_MAX_LENGTH"):
        DataSetConfig(_env_file=None)


def test_oauth_ttl_days_defaults_to_fourteen() -> None:
    config = _IsolatedAuthConfig()

    assert config.OAUTH_TTL_DAYS == 14


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("30", 30), ("1", 1), ("365", 365), ("0", 1), ("-5", 1), ("500", 365), ("invalid", 14), ("", 14)],
)
def test_oauth_ttl_days_clamps_or_falls_back_instead_of_failing(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_TTL_DAYS=configured)

    assert expected == config.OAUTH_TTL_DAYS


class _IsolatedFileUploadConfig(InitSettingsOnly, FileUploadConfig):
    pass


class _IsolatedLoggingConfig(InitSettingsOnly, LoggingConfig):
    pass


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        (None, None),
        ("", ""),
        ("UTC", "UTC"),
        ("Asia/Shanghai", "Asia/Shanghai"),
        ("US/Eastern", "US/Eastern"),
    ],
)
def test_log_timezone_preserves_unset_and_directly_valid_values(configured: str | None, expected: str | None) -> None:
    config = _IsolatedLoggingConfig(LOG_TZ=configured)

    assert expected == config.LOG_TZ


def test_log_timezone_defaults_to_utc() -> None:
    config = _IsolatedLoggingConfig()

    assert config.LOG_TZ == "UTC"


def test_log_timezone_does_not_build_casefold_index_for_direct_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_called() -> dict[str, str]:
        pytest.fail("direct ZoneInfo matches must not scan all available timezone names")

    monkeypatch.setattr(feature_config, "_timezone_names_by_casefold", fail_if_called)

    config = _IsolatedLoggingConfig(LOG_TZ="UTC")

    assert config.LOG_TZ == "UTC"


@pytest.mark.parametrize(
    ("configured", "iana_name"),
    [
        ("utc", "UTC"),
        ("asia/shanghai", "Asia/Shanghai"),
        ("europe/dublin", "Europe/Dublin"),
    ],
)
def test_log_timezone_accepts_case_insensitive_names_with_equivalent_offsets(configured: str, iana_name: str) -> None:
    config = _IsolatedLoggingConfig(LOG_TZ=configured)

    assert config.LOG_TZ is not None
    assert config.LOG_TZ.casefold() == iana_name.casefold()

    configured_timezone = ZoneInfo(config.LOG_TZ)
    expected_timezone = ZoneInfo(iana_name)
    for instant in (
        datetime(2026, 1, 15, 12, tzinfo=UTC),
        datetime(2026, 7, 15, 12, tzinfo=UTC),
    ):
        assert instant.astimezone(configured_timezone).utcoffset() == instant.astimezone(expected_timezone).utcoffset()


@pytest.mark.parametrize("configured", ["Not/AZone", "America", "A/../B\nINJECTED"])
def test_log_timezone_rejects_unknown_or_malformed_values(configured: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        _IsolatedLoggingConfig(LOG_TZ=configured)

    assert repr(configured) in str(exc_info.value)


def test_paid_plan_file_size_limit_uses_its_default() -> None:
    config = _IsolatedFileUploadConfig(UPLOAD_FILE_SIZE_LIMIT="23")

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 15


def test_paid_plan_file_size_limit_can_be_configured_separately() -> None:
    config = _IsolatedFileUploadConfig(
        UPLOAD_FILE_SIZE_LIMIT="23",
        KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN="50",
    )

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 50
