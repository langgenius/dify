from unittest.mock import MagicMock

import pytest

from core.app.app_config.common.sensitive_word_avoidance.manager import (
    SensitiveWordAvoidanceConfigManager,
)


class TestSensitiveWordAvoidanceConfigManagerConvert:
    """Tests for convert classmethod"""

    @pytest.mark.parametrize(
        "config",
        [
            {},
            {"sensitive_word_avoidance": None},
            {"sensitive_word_avoidance": {}},
            {"sensitive_word_avoidance": {"enabled": False}},
        ],
    )
    def test_convert_returns_none_when_disabled_or_missing(self, config):
        # Act
        result = SensitiveWordAvoidanceConfigManager.convert(config)

        # Assert
        assert result is None

    def test_convert_returns_entity_when_enabled(self, mocker):
        # Arrange
        mock_entity = MagicMock()
        mocker.patch(
            "core.app.app_config.common.sensitive_word_avoidance.manager.SensitiveWordAvoidanceEntity",
            return_value=mock_entity,
        )

        config = {
            "sensitive_word_avoidance": {
                "enabled": True,
                "type": "mock_type",
                "config": {"key": "value"},
            }
        }

        # Act
        result = SensitiveWordAvoidanceConfigManager.convert(config)

        # Assert
        assert result == mock_entity

    def test_convert_enabled_without_type_or_config(self, mocker):
        # Arrange
        mock_entity = MagicMock()
        patched = mocker.patch(
            "core.app.app_config.common.sensitive_word_avoidance.manager.SensitiveWordAvoidanceEntity",
            return_value=mock_entity,
        )

        config = {"sensitive_word_avoidance": {"enabled": True}}

        # Act
        result = SensitiveWordAvoidanceConfigManager.convert(config)

        # Assert
        patched.assert_called_once_with(type=None, config={})
        assert result == mock_entity


class TestSensitiveWordAvoidanceConfigManagerValidateAndSetDefaults:
    """Tests for validate_and_set_defaults classmethod"""

    @pytest.fixture
    def base_config(self):
        return {}

    def test_validate_sets_default_when_missing(self, base_config):
        # Act
        config, fields = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id="tenant1", config=base_config.copy()
        )

        # Assert
        assert config["sensitive_word_avoidance"]["enabled"] is False
        assert fields == ["sensitive_word_avoidance"]

    def test_validate_raises_when_not_dict(self):
        config = {"sensitive_word_avoidance": "invalid"}

        with pytest.raises(ValueError, match="must be of dict type"):
            SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(tenant_id="tenant1", config=config)

    @pytest.mark.parametrize(
        "config",
        [
            {"sensitive_word_avoidance": {"enabled": False}},
            {"sensitive_word_avoidance": {"enabled": None}},
            {"sensitive_word_avoidance": {}},
        ],
    )
    def test_validate_disables_when_enabled_false_or_missing(self, config):
        # Act
        result_config, _ = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id="tenant1", config=config
        )

        # Assert
        assert result_config["sensitive_word_avoidance"]["enabled"] is False

    def test_validate_raises_when_enabled_true_without_type(self):
        config = {"sensitive_word_avoidance": {"enabled": True}}

        with pytest.raises(ValueError, match="type is required"):
            SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(tenant_id="tenant1", config=config)

    def test_validate_raises_when_type_not_string(self):
        config = {
            "sensitive_word_avoidance": {
                "enabled": True,
                "type": 123,
            }
        }

        with pytest.raises(ValueError, match="must be a string"):
            SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(tenant_id="tenant1", config=config)

    def test_validate_raises_when_config_not_dict(self):
        config = {
            "sensitive_word_avoidance": {
                "enabled": True,
                "type": "mock_type",
                "config": "invalid",
            }
        }

        with pytest.raises(ValueError, match="must be a dict"):
            SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(tenant_id="tenant1", config=config)

    def test_validate_calls_moderation_factory(self, mocker):
        # Arrange
        mock_validate = mocker.patch(
            "core.app.app_config.common.sensitive_word_avoidance.manager.ModerationFactory.validate_config"
        )

        config = {
            "sensitive_word_avoidance": {
                "enabled": True,
                "type": "mock_type",
                "config": {"k": "v"},
            }
        }

        # Act
        result_config, fields = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id="tenant1", config=config
        )

        # Assert
        mock_validate.assert_called_once_with(name="mock_type", tenant_id="tenant1", config={"k": "v"})
        assert result_config["sensitive_word_avoidance"]["enabled"] is True
        assert fields == ["sensitive_word_avoidance"]

    def test_validate_sets_empty_dict_when_config_none(self, mocker):
        # Arrange
        mock_validate = mocker.patch(
            "core.app.app_config.common.sensitive_word_avoidance.manager.ModerationFactory.validate_config"
        )

        config = {
            "sensitive_word_avoidance": {
                "enabled": True,
                "type": "mock_type",
                "config": None,
            }
        }

        # Act
        SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(tenant_id="tenant1", config=config)

        # Assert
        mock_validate.assert_called_once_with(name="mock_type", tenant_id="tenant1", config={})

    def test_validate_only_structure_validate_skips_factory(self, mocker):
        # Arrange
        mock_validate = mocker.patch(
            "core.app.app_config.common.sensitive_word_avoidance.manager.ModerationFactory.validate_config"
        )

        config = {
            "sensitive_word_avoidance": {
                "enabled": True,
                "type": "mock_type",
                "config": {"k": "v"},
            }
        }

        # Act
        SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id="tenant1", config=config, only_structure_validate=True
        )

        # Assert
        mock_validate.assert_not_called()
