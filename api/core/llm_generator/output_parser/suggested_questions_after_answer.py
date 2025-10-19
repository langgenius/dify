import json
import re
from collections.abc import Sequence

from core.llm_generator.prompts import SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT


class SuggestedQuestionsAfterAnswerOutputParser:
    def get_format_instructions(self) -> str:
        return SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

    def parse(self, text: str) -> Sequence[str]:
        action_match = re.search(r"\[.*?\]", text.strip(), re.DOTALL)
        questions: list[str] = []
        if action_match is not None:
            json_obj = json.loads(action_match.group(0).strip())
            if isinstance(json_obj, list):
                questions = [question for question in json_obj if isinstance(question, str)]
        return questions
