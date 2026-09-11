from core.llm_generator.output_parser.suggested_questions_after_answer import (
    SuggestedQuestionsAfterAnswerOutputParser,
)


class TestSuggestedQuestionsAfterAnswerOutputParser:
    def test_parse_clean_json_array(self):
        parser = SuggestedQuestionsAfterAnswerOutputParser()
        text = 'questions:\n["What is Dify?", "How to build an app?", "Why use RAG?"]'

        result = parser.parse(text)

        assert list(result) == ["What is Dify?", "How to build an app?", "Why use RAG?"]

    def test_parse_strips_closed_think_block_with_inner_brackets(self):
        parser = SuggestedQuestionsAfterAnswerOutputParser()
        text = (
            "<think>\n"
            "Relevant tokens are [MASK] and probabilities [0.2, 0.8]. "
            'Ignore ["bad question from reasoning"].\n'
            "</think>\n"
            '["What is Dify?", "How to build an app?", "Why use RAG?"]'
        )

        result = parser.parse(text)

        assert list(result) == ["What is Dify?", "How to build an app?", "Why use RAG?"]

    def test_parse_strips_unclosed_think_block(self):
        parser = SuggestedQuestionsAfterAnswerOutputParser()
        text = '<think>Analyzing the answer: score vector [0.1, 0.9] and ["bad question from reasoning"]'

        result = parser.parse(text)

        assert list(result) == []
