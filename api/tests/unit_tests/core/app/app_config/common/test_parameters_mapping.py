from typing import Literal

import pytest

# Module under test
from core.app.app_config.common import parameters_mapping
from tests.unit_tests.config_override import apply_config_overrides

type _DefaultedFeatureKey = Literal[
    "suggested_questions",
    "suggested_questions_after_answer",
    "speech_to_text",
    "text_to_speech",
    "retriever_resource",
    "annotation_reply",
    "more_like_this",
    "sensitive_word_avoidance",
]


class TestGetParametersFromFeatureDict:
    """Test suite for get_parameters_from_feature_dict"""

    @pytest.fixture
    def mock_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Override file limits on the shared typed config."""
        apply_config_overrides(
            monkeypatch,
            UPLOAD_IMAGE_FILE_SIZE_LIMIT=1,
            UPLOAD_VIDEO_FILE_SIZE_LIMIT=2,
            UPLOAD_AUDIO_FILE_SIZE_LIMIT=3,
            UPLOAD_FILE_SIZE_LIMIT=4,
            WORKFLOW_FILE_UPLOAD_LIMIT=5,
        )

    @pytest.fixture
    def mock_default_file_limits(self, monkeypatch: pytest.MonkeyPatch) -> int:
        """Mock DEFAULT_FILE_NUMBER_LIMITS constant"""
        monkeypatch.setattr(parameters_mapping, "DEFAULT_FILE_NUMBER_LIMITS", 99)
        return 99

    @pytest.fixture
    def minimal_inputs(self) -> tuple[dict[str, object], list[dict[str, object]]]:
        return {}, []

    @pytest.mark.parametrize(
        ("feature_key", "expected_default"),
        [
            ("suggested_questions", []),
            ("suggested_questions_after_answer", {"enabled": False}),
            ("speech_to_text", {"enabled": False}),
            ("text_to_speech", {"enabled": False}),
            ("retriever_resource", {"enabled": False}),
            ("annotation_reply", {"enabled": False}),
            ("more_like_this", {"enabled": False}),
            (
                "sensitive_word_avoidance",
                {"enabled": False, "type": "", "configs": []},
            ),
        ],
    )
    def test_defaults_when_key_missing(
        self,
        feature_key: _DefaultedFeatureKey,
        expected_default: object,
        mock_config: None,
        mock_default_file_limits: int,
    ) -> None:
        # Arrange
        features = {}
        user_input = []

        # Act
        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=user_input,
        )

        # Assert
        assert result[feature_key] == expected_default

    def test_opening_statement_present(self, mock_config: None, mock_default_file_limits: int) -> None:
        # Arrange
        features = {"opening_statement": "Hello"}

        # Act
        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=[],
        )

        # Assert
        assert result["opening_statement"] == "Hello"

    def test_opening_statement_missing_returns_none(self, mock_config: None, mock_default_file_limits: int) -> None:
        # Arrange
        features = {}

        # Act
        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=[],
        )

        # Assert
        assert result["opening_statement"] is None

    def test_all_features_provided(self, mock_config: None, mock_default_file_limits: int) -> None:
        # Arrange
        features = {
            "opening_statement": "Hi",
            "suggested_questions": ["Q1"],
            "suggested_questions_after_answer": {"enabled": True},
            "speech_to_text": {"enabled": True},
            "text_to_speech": {"enabled": True},
            "retriever_resource": {"enabled": True},
            "annotation_reply": {"enabled": True},
            "more_like_this": {"enabled": True},
            "sensitive_word_avoidance": {
                "enabled": True,
                "type": "strict",
                "configs": ["a"],
            },
            "file_upload": {
                "image": {
                    "enabled": True,
                    "number_limits": 10,
                    "detail": "low",
                    "transfer_methods": ["local_file"],
                }
            },
        }
        user_input = [{"name": "field1"}]

        # Act
        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=user_input,
        )

        # Assert
        result_dict: dict[str, object] = dict(result)
        for key in features:
            assert result_dict[key] == features[key]
        assert result["user_input_form"] == user_input

    def test_file_upload_default_structure(self, mock_config: None, mock_default_file_limits: int) -> None:
        # Arrange
        features = {}

        # Act
        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=[],
        )

        # Assert
        file_upload = result["file_upload"]
        assert file_upload["image"]["enabled"] is False
        assert file_upload["image"]["number_limits"] == 99
        assert file_upload["image"]["detail"] == "high"
        assert "remote_url" in file_upload["image"]["transfer_methods"]
        assert "local_file" in file_upload["image"]["transfer_methods"]

    def test_system_parameters_from_config(self, mock_config: None, mock_default_file_limits: int) -> None:
        # Arrange
        features = {}

        # Act
        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=[],
        )

        # Assert
        system_params = result["system_parameters"]
        assert system_params["image_file_size_limit"] == 1
        assert system_params["video_file_size_limit"] == 2
        assert system_params["audio_file_size_limit"] == 3
        assert system_params["file_size_limit"] == 4
        assert system_params["workflow_file_upload_limit"] == 5

    @pytest.mark.parametrize(
        ("features_dict", "user_input_form"),
        [
            (None, []),
            ([], []),
            ("invalid", []),
        ],
    )
    def test_invalid_features_dict_type_raises(
        self, features_dict: object, user_input_form: list[dict[str, object]]
    ) -> None:
        # Act & Assert
        with pytest.raises(AttributeError):
            parameters_mapping.get_parameters_from_feature_dict(
                features_dict=features_dict,  # pyrefly: ignore[bad-argument-type]
                user_input_form=user_input_form,
            )

    @pytest.mark.parametrize(
        "user_input_form",
        [None, "invalid", 123],
    )
    def test_user_input_form_invalid_type(
        self, mock_config: None, mock_default_file_limits: int, user_input_form: object
    ) -> None:
        # Arrange
        features = {}

        # Act
        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=user_input_form,  # pyrefly: ignore[bad-argument-type]
        )

        # Assert
        assert result["user_input_form"] == user_input_form

    def test_empty_user_input_form(self, mock_config: None, mock_default_file_limits: int) -> None:
        features = {}
        user_input = []

        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=user_input,
        )

        assert result["user_input_form"] == []

    def test_feature_values_none(self, mock_config: None, mock_default_file_limits: int) -> None:
        features: dict[str, object] = {
            "suggested_questions": None,
            "speech_to_text": None,
        }

        result = parameters_mapping.get_parameters_from_feature_dict(
            features_dict=features,
            user_input_form=[],
        )

        assert result["suggested_questions"] is None
        assert result["speech_to_text"] is None
