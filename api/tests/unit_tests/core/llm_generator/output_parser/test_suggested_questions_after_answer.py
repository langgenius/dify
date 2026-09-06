from core.llm_generator.output_parser.suggested_questions_after_answer import (
    SuggestedQuestionsAfterAnswerOutputParser,
)


class TestSuggestedQuestionsAfterAnswerOutputParser:
    def test_parse_plain_array(self) -> None:
        parser = SuggestedQuestionsAfterAnswerOutputParser()
        text = 'questions:\n["What is Dify?", "How to build an app?"]'

        result = parser.parse(text)

        assert list(result) == ["What is Dify?", "How to build an app?"]

    def test_parse_strips_think_block_before_matching(self) -> None:
        parser = SuggestedQuestionsAfterAnswerOutputParser()
        text = (
            "<think>\n"
            "The user asked about Dify. Relevant tokens are [CLS] and probabilities [0.2, 0.8].\n"
            "</think>\n"
            '["What is Dify?", "How to build an app?"]'
        )

        result = parser.parse(text)

        assert list(result) == ["What is Dify?", "How to build an app?"]

    def test_parse_ignores_numeric_array_inside_think_block(self) -> None:
        # Regression for #41854: a numeric array inside <think> used to be matched first and
        # parsed successfully, but was then filtered out as non-strings, yielding [].
        parser = SuggestedQuestionsAfterAnswerOutputParser()
        text = '<think>score vector: [0.2, 0.8]</think>\n["What is Dify?"]'

        result = parser.parse(text)

        assert list(result) == ["What is Dify?"]

    def test_parse_ignores_invalid_array_inside_think_block(self) -> None:
        parser = SuggestedQuestionsAfterAnswerOutputParser()
        text = '<think>masked token: [MASK]</think>\n["What is Dify?"]'

        result = parser.parse(text)

        assert list(result) == ["What is Dify?"]

    def test_parse_empty_without_payload(self) -> None:
        parser = SuggestedQuestionsAfterAnswerOutputParser()

        result = parser.parse("no questions here")

        assert list(result) == []
