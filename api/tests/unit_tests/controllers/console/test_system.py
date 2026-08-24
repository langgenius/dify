import logging
from unittest.mock import MagicMock, patch

import pytest

import controllers.console.system as system_module


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
            patch.object(
                system_module.dify_config,
                "CHECK_UPDATE_URL",
                "",
            ),
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
            patch.object(
                system_module.dify_config,
                "CHECK_UPDATE_URL",
                "http://example.com",
            ),
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
            patch.object(
                system_module.dify_config,
                "CHECK_UPDATE_URL",
                "http://example.com",
            ),
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
            patch.object(
                system_module.dify_config,
                "CHECK_UPDATE_URL",
                "http://example.com",
            ),
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
