from collections import UserDict
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.app.app_config.base_app_config_manager import BaseAppConfigManager


class TestBaseAppConfigManager:
    @pytest.fixture
    def mock_config_dict(self):
        return {"key": "value", "another": 123}

    @pytest.fixture
    def mock_app_additional_features(self, mocker: MockerFixture):
        mock_instance = MagicMock()
        mocker.patch(
            "core.app.app_config.base_app_config_manager.AppAdditionalFeatures",
            return_value=mock_instance,
        )
        return mock_instance

    @pytest.fixture
    def mock_managers(self, mocker: MockerFixture):
        retrieval = mocker.patch(
            "core.app.app_config.base_app_config_manager.RetrievalResourceConfigManager.convert",
            return_value="retrieval_result",
        )
        file_upload = mocker.patch(
            "core.app.app_config.base_app_config_manager.FileUploadConfigManager.convert",
            return_value="file_upload_result",
        )
        opening_statement = mocker.patch(
            "core.app.app_config.base_app_config_manager.OpeningStatementConfigManager.convert",
            return_value=("opening_result", "suggested_result"),
        )
        suggested_after = mocker.patch(
            "core.app.app_config.base_app_config_manager.SuggestedQuestionsAfterAnswerConfigManager.convert",
            return_value="suggested_after_result",
        )
        more_like_this = mocker.patch(
            "core.app.app_config.base_app_config_manager.MoreLikeThisConfigManager.convert",
            return_value="more_like_this_result",
        )
        speech_to_text = mocker.patch(
            "core.app.app_config.base_app_config_manager.SpeechToTextConfigManager.convert",
            return_value="speech_to_text_result",
        )
        text_to_speech = mocker.patch(
            "core.app.app_config.base_app_config_manager.TextToSpeechConfigManager.convert",
            return_value="text_to_speech_result",
        )

        return {
            "retrieval": retrieval,
            "file_upload": file_upload,
            "opening_statement": opening_statement,
            "suggested_after": suggested_after,
            "more_like_this": more_like_this,
            "speech_to_text": speech_to_text,
            "text_to_speech": text_to_speech,
        }

    @pytest.mark.parametrize(
        ("app_mode", "expected_is_vision"),
        [
            ("CHAT", True),
            ("COMPLETION", True),
            ("AGENT_CHAT", True),
            ("OTHER", False),
        ],
    )
    def test_convert_features_all_modes(
        self,
        mocker: MockerFixture,
        mock_config_dict,
        mock_app_additional_features,
        mock_managers,
        app_mode,
        expected_is_vision,
    ):
        # Arrange
        mock_app_mode = MagicMock()
        mock_app_mode.CHAT = "CHAT"
        mock_app_mode.COMPLETION = "COMPLETION"
        mock_app_mode.AGENT_CHAT = "AGENT_CHAT"

        mocker.patch(
            "core.app.app_config.base_app_config_manager.AppMode",
            mock_app_mode,
        )

        # Act
        result = BaseAppConfigManager.convert_features(mock_config_dict, app_mode)

        # Assert
        assert result == mock_app_additional_features
        mock_managers["retrieval"].assert_called_once_with(config=dict(mock_config_dict.items()))
        mock_managers["file_upload"].assert_called_once()
        _, kwargs = mock_managers["file_upload"].call_args
        assert kwargs["config"] == dict(mock_config_dict.items())
        assert kwargs["is_vision"] is expected_is_vision

        mock_managers["opening_statement"].assert_called_once_with(config=dict(mock_config_dict.items()))
        mock_managers["suggested_after"].assert_called_once_with(config=dict(mock_config_dict.items()))
        mock_managers["more_like_this"].assert_called_once_with(config=dict(mock_config_dict.items()))
        mock_managers["speech_to_text"].assert_called_once_with(config=dict(mock_config_dict.items()))
        mock_managers["text_to_speech"].assert_called_once_with(config=dict(mock_config_dict.items()))

    def test_convert_features_empty_config(self, mocker: MockerFixture, mock_app_additional_features, mock_managers):
        # Arrange
        empty_config = {}
        mock_app_mode = MagicMock()
        mock_app_mode.CHAT = "CHAT"
        mock_app_mode.COMPLETION = "COMPLETION"
        mock_app_mode.AGENT_CHAT = "AGENT_CHAT"

        mocker.patch(
            "core.app.app_config.base_app_config_manager.AppMode",
            mock_app_mode,
        )

        # Act
        result = BaseAppConfigManager.convert_features(empty_config, "CHAT")

        # Assert
        assert result == mock_app_additional_features
        for manager in mock_managers.values():
            assert manager.called

    @pytest.mark.parametrize(
        "invalid_config",
        [
            None,
            "string",
            123,
            12.34,
            [],
        ],
    )
    def test_convert_features_invalid_config_raises(self, invalid_config):
        # Act & Assert
        with pytest.raises((TypeError, AttributeError)):
            BaseAppConfigManager.convert_features(invalid_config, "CHAT")

    def test_convert_features_manager_exception_propagates(self, mocker: MockerFixture, mock_config_dict):
        # Arrange
        mocker.patch(
            "core.app.app_config.base_app_config_manager.RetrievalResourceConfigManager.convert",
            side_effect=RuntimeError("manager failure"),
        )

        # Act & Assert
        with pytest.raises(RuntimeError):
            BaseAppConfigManager.convert_features(mock_config_dict, "CHAT")

    def test_convert_features_mapping_subclass(
        self, mocker: MockerFixture, mock_app_additional_features, mock_managers
    ):
        # Arrange
        class CustomMapping(UserDict):
            pass

        custom_config = CustomMapping({"a": 1})

        mock_app_mode = MagicMock()
        mock_app_mode.CHAT = "CHAT"
        mock_app_mode.COMPLETION = "COMPLETION"
        mock_app_mode.AGENT_CHAT = "AGENT_CHAT"

        mocker.patch(
            "core.app.app_config.base_app_config_manager.AppMode",
            mock_app_mode,
        )

        # Act
        result = BaseAppConfigManager.convert_features(custom_config, "CHAT")

        # Assert
        assert result == mock_app_additional_features
        for manager in mock_managers.values():
            assert manager.called
