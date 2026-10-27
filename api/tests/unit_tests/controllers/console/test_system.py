import builtins
import logging
from unittest.mock import MagicMock, patch

import pytest
from flask.views import MethodView

import controllers.console.system as system_module
from configs import dify_config
from controllers.console.system import _has_new_version
from dify_app import DifyApp
from extensions import ext_fastopenapi
from tests.helpers.unit.config_override import config_overrides_context

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


class TestFastopenapiSystemCases:
    @staticmethod
    @pytest.fixture
    def app() -> DifyApp:
        app = DifyApp(__name__)
        app.config["TESTING"] = True
        return app

    @staticmethod
    def test_console_ping_fastopenapi_returns_pong(app: DifyApp) -> None:
        ext_fastopenapi.init_app(app)

        response = app.test_client().get("/console/api/ping")

        assert response.status_code == 200
        assert response.get_json() == {"result": "pong"}

    @staticmethod
    def test_console_version_fastopenapi_returns_current_version(app: DifyApp) -> None:
        ext_fastopenapi.init_app(app)

        with config_overrides_context(CHECK_UPDATE_URL=None):
            response = app.test_client().get("/console/api/version", query_string={"current_version": "0.0.0"})

        assert response.status_code == 200
        assert response.get_json() == {
            "version": dify_config.project.version,
            "release_notes": "",
        }


class TestSystemCases:
    class TestHasNewVersion:
        def test_has_new_version_true(self) -> None:
            result = system_module._has_new_version(
                latest_version="1.2.0",
                current_version="1.1.0",
            )
            assert result is True

        def test_has_new_version_false(self) -> None:
            result = system_module._has_new_version(
                latest_version="1.0.0",
                current_version="1.1.0",
            )
            assert result is False

        def test_has_new_version_invalid_version(self, caplog: pytest.LogCaptureFixture) -> None:
            with caplog.at_level(logging.WARNING, logger="controllers.console.system"):
                result = system_module._has_new_version(
                    latest_version="invalid",
                    current_version="1.0.0",
                )

            assert result is False
            assert "Invalid version format" in caplog.text

    class TestCheckVersionUpdate:
        def test_no_check_update_url(self) -> None:
            query = system_module.VersionQuery(current_version="1.0.0")

            with (
                config_overrides_context(CHECK_UPDATE_URL=""),
                patch.object(
                    system_module.dify_config.project,
                    "version",
                    "1.0.0",
                ),
            ):
                result = system_module.check_version_update(query)

            assert result == system_module.VersionResponse(version="1.0.0", release_notes="")

        def test_http_error_fallback(self, caplog: pytest.LogCaptureFixture) -> None:
            query = system_module.VersionQuery(current_version="1.0.0")

            with (
                config_overrides_context(CHECK_UPDATE_URL="http://example.com"),
                patch.object(
                    system_module.httpx,
                    "get",
                    side_effect=Exception("boom"),
                ),
                caplog.at_level(logging.WARNING, logger="controllers.console.system"),
            ):
                result = system_module.check_version_update(query)

            assert result.version == "1.0.0"
            assert "Check update version error" in caplog.text

        def test_new_version_available(self) -> None:
            query = system_module.VersionQuery(current_version="1.0.0")

            response = MagicMock()
            response.json.return_value = {
                "version": "1.2.0",
                "releaseNotes": "New features",
            }

            with (
                config_overrides_context(CHECK_UPDATE_URL="http://example.com"),
                patch.object(
                    system_module.httpx,
                    "get",
                    return_value=response,
                ),
                patch.object(
                    system_module.dify_config.project,
                    "version",
                    "1.0.0",
                ),
            ):
                result = system_module.check_version_update(query)

            assert result.version == "1.2.0"
            assert result.release_notes == "New features"

        def test_no_new_version(self) -> None:
            query = system_module.VersionQuery(current_version="1.2.0")

            response = MagicMock()
            response.json.return_value = {
                "version": "1.1.0",
            }

            with (
                config_overrides_context(CHECK_UPDATE_URL="http://example.com"),
                patch.object(
                    system_module.httpx,
                    "get",
                    return_value=response,
                ),
                patch.object(
                    system_module.dify_config.project,
                    "version",
                    "1.2.0",
                ),
            ):
                result = system_module.check_version_update(query)

            assert result == system_module.VersionResponse(version="1.2.0", release_notes="")


class TestCompareVersionsCases:
    @staticmethod
    @pytest.mark.parametrize(
        ("latest_version", "current_version", "expected"),
        [
            ("1.0.1", "1.0.0", True),
            ("1.1.0", "1.0.0", True),
            ("2.0.0", "1.9.9", True),
            ("1.0.0", "1.0.0", False),
            ("1.0.0", "1.0.1", False),
            ("1.0.0", "2.0.0", False),
            ("1.0.1", "1.0.0-beta", True),
            ("1.0.0", "1.0.0-alpha", True),
            ("1.0.0-beta", "1.0.0-alpha", True),
            ("1.0.0", "1.0.0-rc1", True),
            ("1.0.0", "0.9.9", True),
            ("1.0.0", "1.0.0-dev", True),
        ],
    )
    def test_has_new_version(latest_version: str, current_version: str, expected: bool) -> None:
        assert _has_new_version(latest_version=latest_version, current_version=current_version) == expected
