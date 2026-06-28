import pytest

from core.llm_generator.output_parser.suggested_questions_after_answer import (
    SuggestedQuestionsAfterAnswerOutputParser,
)


@pytest.fixture
def parser() -> SuggestedQuestionsAfterAnswerOutputParser:
    return SuggestedQuestionsAfterAnswerOutputParser()


class TestSuggestedQuestionsAfterAnswerOutputParser:
    def test_parse_plain_json_array(self, parser: SuggestedQuestionsAfterAnswerOutputParser):
        questions = parser.parse('["Question 1?", "Question 2?"]')
        assert questions == ["Question 1?", "Question 2?"]

    def test_parse_strips_closed_reasoning_block(self, parser: SuggestedQuestionsAfterAnswerOutputParser):
        text = (
            "<think>\nThe user asked about Python.\n</think>\n"
            '["What are Python decorators?", "How does async work in Python?"]'
        )
        questions = parser.parse(text)
        assert questions == ["What are Python decorators?", "How does async work in Python?"]

    def test_parse_strips_empty_reasoning_block(self, parser: SuggestedQuestionsAfterAnswerOutputParser):
        text = '<think></think>\n["What is recursion?", "How do hash maps work?"]'
        questions = parser.parse(text)
        assert questions == ["What is recursion?", "How do hash maps work?"]

    def test_parse_handles_unclosed_reasoning_block(self, parser: SuggestedQuestionsAfterAnswerOutputParser):
        text = (
            "<think>\nThe model was reasoning but output was truncated"
            '["Can you explain closures?", "What are generators?"]'
        )
        questions = parser.parse(text)
        assert questions == ["Can you explain closures?", "What are generators?"]

    def test_parse_ignores_non_string_entries(self, parser: SuggestedQuestionsAfterAnswerOutputParser):
        questions = parser.parse('["Valid?", 42, null, "Also valid?"]')
        assert questions == ["Valid?", "Also valid?"]
