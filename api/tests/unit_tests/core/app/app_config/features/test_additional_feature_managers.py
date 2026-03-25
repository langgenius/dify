import pytest

from core.app.app_config.entities import TextToSpeechEntity
from core.app.app_config.features.more_like_this.manager import MoreLikeThisConfigManager
from core.app.app_config.features.opening_statement.manager import OpeningStatementConfigManager
from core.app.app_config.features.retrieval_resource.manager import RetrievalResourceConfigManager
from core.app.app_config.features.speech_to_text.manager import SpeechToTextConfigManager
from core.app.app_config.features.suggested_questions_after_answer.manager import (
    SuggestedQuestionsAfterAnswerConfigManager,
)
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager


class TestAdditionalFeatureManagers:
    def test_opening_statement_validate_defaults(self):
        config, keys = OpeningStatementConfigManager.validate_and_set_defaults({})
        assert config["opening_statement"] == ""
        assert config["suggested_questions"] == []
        assert set(keys) == {"opening_statement", "suggested_questions"}

    def test_opening_statement_validate_types(self):
        with pytest.raises(ValueError):
            OpeningStatementConfigManager.validate_and_set_defaults({"opening_statement": 123})
        with pytest.raises(ValueError):
            OpeningStatementConfigManager.validate_and_set_defaults(
                {"opening_statement": "hi", "suggested_questions": "bad"}
            )
        with pytest.raises(ValueError):
            OpeningStatementConfigManager.validate_and_set_defaults(
                {"opening_statement": "hi", "suggested_questions": [1]}
            )

    def test_opening_statement_convert(self):
        opening, questions = OpeningStatementConfigManager.convert(
            {"opening_statement": "hello", "suggested_questions": ["q1"]}
        )
        assert opening == "hello"
        assert questions == ["q1"]

    def test_retrieval_resource_validate(self):
        config, keys = RetrievalResourceConfigManager.validate_and_set_defaults({})
        assert config["retriever_resource"]["enabled"] is False
        assert keys == ["retriever_resource"]

        with pytest.raises(ValueError):
            RetrievalResourceConfigManager.validate_and_set_defaults({"retriever_resource": "bad"})
        with pytest.raises(ValueError):
            RetrievalResourceConfigManager.validate_and_set_defaults({"retriever_resource": {"enabled": "yes"}})

    def test_retrieval_resource_convert(self):
        assert RetrievalResourceConfigManager.convert({"retriever_resource": {"enabled": True}}) is True
        assert RetrievalResourceConfigManager.convert({"retriever_resource": {"enabled": False}}) is False

    def test_speech_to_text_validate_and_convert(self):
        config, keys = SpeechToTextConfigManager.validate_and_set_defaults({})
        assert config["speech_to_text"]["enabled"] is False
        assert keys == ["speech_to_text"]

        with pytest.raises(ValueError):
            SpeechToTextConfigManager.validate_and_set_defaults({"speech_to_text": "bad"})
        with pytest.raises(ValueError):
            SpeechToTextConfigManager.validate_and_set_defaults({"speech_to_text": {"enabled": "yes"}})

        assert SpeechToTextConfigManager.convert({"speech_to_text": {"enabled": True}}) is True
        assert SpeechToTextConfigManager.convert({"speech_to_text": {"enabled": False}}) is False

    def test_suggested_questions_after_answer_validate_and_convert(self):
        config, keys = SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults({})
        assert config["suggested_questions_after_answer"]["enabled"] is False
        assert keys == ["suggested_questions_after_answer"]

        with pytest.raises(ValueError):
            SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults(
                {"suggested_questions_after_answer": "bad"}
            )
        with pytest.raises(ValueError):
            SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults(
                {"suggested_questions_after_answer": {"enabled": "yes"}}
            )

        assert (
            SuggestedQuestionsAfterAnswerConfigManager.convert({"suggested_questions_after_answer": {"enabled": True}})
            is True
        )
        assert (
            SuggestedQuestionsAfterAnswerConfigManager.convert({"suggested_questions_after_answer": {"enabled": False}})
            is False
        )

    def test_text_to_speech_validate_and_convert(self):
        config, keys = TextToSpeechConfigManager.validate_and_set_defaults({})
        assert config["text_to_speech"]["enabled"] is False
        assert keys == ["text_to_speech"]

        with pytest.raises(ValueError):
            TextToSpeechConfigManager.validate_and_set_defaults({"text_to_speech": "bad"})
        with pytest.raises(ValueError):
            TextToSpeechConfigManager.validate_and_set_defaults({"text_to_speech": {"enabled": "yes"}})

        result = TextToSpeechConfigManager.convert(
            {"text_to_speech": {"enabled": True, "voice": "v", "language": "en"}}
        )
        assert isinstance(result, TextToSpeechEntity)
        assert result.voice == "v"
        assert result.language == "en"

    def test_more_like_this_convert_and_validate(self):
        config, keys = MoreLikeThisConfigManager.validate_and_set_defaults({})
        assert config["more_like_this"]["enabled"] is False
        assert keys == ["more_like_this"]

        assert MoreLikeThisConfigManager.convert({"more_like_this": {"enabled": True}}) is True
        assert MoreLikeThisConfigManager.convert({"more_like_this": {"enabled": False}}) is False
        with pytest.raises(ValueError):
            MoreLikeThisConfigManager.validate_and_set_defaults({"more_like_this": "bad"})
