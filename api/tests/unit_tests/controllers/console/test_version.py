from unittest.mock import MagicMock, patch

import controllers.console.version as version_module


class TestHasNewVersion:
    def test_has_new_version_true(self):
        result = version_module._has_new_version(
            latest_version="1.2.0",
            current_version="1.1.0",
        )
        assert result is True

    def test_has_new_version_false(self):
        result = version_module._has_new_version(
            latest_version="1.0.0",
            current_version="1.1.0",
        )
        assert result is False

    def test_has_new_version_invalid_version(self):
        with patch.object(version_module.logger, "warning") as log_warning:
            result = version_module._has_new_version(
                latest_version="invalid",
                current_version="1.0.0",
            )

        assert result is False
        log_warning.assert_called_once()


class TestCheckVersionUpdate:
    def test_no_check_update_url(self):
        query = version_module.VersionQuery(current_version="1.0.0")

        with (
            patch.object(
                version_module.dify_config,
                "CHECK_UPDATE_URL",
                "",
            ),
            patch.object(
                version_module.dify_config.project,
                "version",
                "1.0.0",
            ),
            patch.object(
                version_module.dify_config,
                "CAN_REPLACE_LOGO",
                True,
            ),
            patch.object(
                version_module.dify_config,
                "MODEL_LB_ENABLED",
                False,
            ),
        ):
            result = version_module.check_version_update(query)

        assert result.version == "1.0.0"
        assert result.can_auto_update is False
        assert result.features.can_replace_logo is True
        assert result.features.model_load_balancing_enabled is False

    def test_http_error_fallback(self):
        query = version_module.VersionQuery(current_version="1.0.0")

        with (
            patch.object(
                version_module.dify_config,
                "CHECK_UPDATE_URL",
                "http://example.com",
            ),
            patch.object(
                version_module.httpx,
                "get",
                side_effect=Exception("boom"),
            ),
            patch.object(
                version_module.logger,
                "warning",
            ) as log_warning,
        ):
            result = version_module.check_version_update(query)

        assert result.version == "1.0.0"
        log_warning.assert_called_once()

    def test_new_version_available(self):
        query = version_module.VersionQuery(current_version="1.0.0")

        response = MagicMock()
        response.json.return_value = {
            "version": "1.2.0",
            "releaseDate": "2024-01-01",
            "releaseNotes": "New features",
            "canAutoUpdate": True,
        }

        with (
            patch.object(
                version_module.dify_config,
                "CHECK_UPDATE_URL",
                "http://example.com",
            ),
            patch.object(
                version_module.httpx,
                "get",
                return_value=response,
            ),
            patch.object(
                version_module.dify_config.project,
                "version",
                "1.0.0",
            ),
            patch.object(
                version_module.dify_config,
                "CAN_REPLACE_LOGO",
                False,
            ),
            patch.object(
                version_module.dify_config,
                "MODEL_LB_ENABLED",
                True,
            ),
        ):
            result = version_module.check_version_update(query)

        assert result.version == "1.2.0"
        assert result.release_date == "2024-01-01"
        assert result.release_notes == "New features"
        assert result.can_auto_update is True

    def test_no_new_version(self):
        query = version_module.VersionQuery(current_version="1.2.0")

        response = MagicMock()
        response.json.return_value = {
            "version": "1.1.0",
        }

        with (
            patch.object(
                version_module.dify_config,
                "CHECK_UPDATE_URL",
                "http://example.com",
            ),
            patch.object(
                version_module.httpx,
                "get",
                return_value=response,
            ),
            patch.object(
                version_module.dify_config.project,
                "version",
                "1.2.0",
            ),
        ):
            result = version_module.check_version_update(query)

        assert result.version == "1.2.0"
        assert result.can_auto_update is False
