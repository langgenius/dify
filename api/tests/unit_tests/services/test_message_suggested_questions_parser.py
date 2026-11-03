"""Suggested-question payload parsing without model/provider I/O."""

import json

import pytest

from core.llm_generator.prompts import DEFAULT_SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT
from services.message_suggested_questions_parser import SuggestedQuestionsAfterAnswerOutputParser


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('["How do I use arr[0]?", "Next?"]', ["How do I use arr[0]?", "Next?"]),
        ('["What does ] mean?", "And [?"]', ["What does ] mean?", "And [?"]),
        ('Questions:\n```json\n["Can I use [a-z]?", "Next?"]\n```', ["Can I use [a-z]?", "Next?"]),
        (json.dumps(['How do I quote "]"?', "Next?"]), ['How do I quote "]"?', "Next?"]),
        ('["Next?", ["nested"], {"name": "value"}, 1, null, true]', ["Next?"]),
        ('["Next?"] trailing prose', ["Next?"]),
        ('["unfinished]', []),
        ("not a question array", []),
        ("[]", []),
    ],
)
def test_parse_suggested_question_payload(text: str, expected: list[str]) -> None:
    assert SuggestedQuestionsAfterAnswerOutputParser().parse(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('["Question 1?", "还有吗？"]', ["Question 1?", "还有吗？"]),
        ('Here are questions:\n["Next?"]', ["Next?"]),
        ('["Next?", 1, null, true]', ["Next?"]),
        ("[]", []),
        ("", []),
        ("not a question array", []),
        ('["unfinished]', []),
    ],
)
def test_response_parser_handles_question_arrays(text: str, expected: list[str]) -> None:
    assert SuggestedQuestionsAfterAnswerOutputParser().parse(text) == expected


@pytest.mark.parametrize("instruction", [None, "", " "])
def test_empty_instruction_uses_default_prompt(instruction: str | None) -> None:
    parser = SuggestedQuestionsAfterAnswerOutputParser(instruction_prompt=instruction)
    assert parser.get_format_instructions() == DEFAULT_SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT


def test_custom_instruction_preserves_json_output_requirement() -> None:
    instructions = SuggestedQuestionsAfterAnswerOutputParser("Ask a follow-up").get_format_instructions()
    assert instructions.startswith("Ask a follow-up\n")
    assert 'JSON array like ["question1", "question2", "question3"]' in instructions
