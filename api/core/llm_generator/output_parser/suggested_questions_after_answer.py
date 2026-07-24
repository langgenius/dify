import json
import logging
import re
from collections.abc import Sequence

from core.llm_generator.prompts import SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

logger = logging.getLogger(__name__)


class SuggestedQuestionsAfterAnswerOutputParser:
    def get_format_instructions(self) -> str:
        return SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

    def parse(self, text: str) -> Sequence[str]:
        action_match = re.search(r"\[.*?\]", text.strip(), re.DOTALL)
        questions: list[str] = []
        if action_match is not None:
            try:
                json_obj = json.loads(action_match.group(0).strip())
            except json.JSONDecodeError as exc:
                logger.warning("Failed to decode suggested questions payload: %s", exc)
            else:
                if isinstance(json_obj, list):
                    questions = [question for question in json_obj if isinstance(question, str)]
        return questions
