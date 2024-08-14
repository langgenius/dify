import json
import re
from typing import Any

from core.llm_generator.prompts import SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT


class SuggestedQuestionsAfterAnswerOutputParser:

    def get_format_instructions(self) -> str:
        return SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

    def parse(self, text: str) -> Any:
        action_match = re.search(r"\[.*?\]", text.strip(), re.DOTALL)
        if action_match is not None:
            json_obj = json.loads(action_match.group(0).strip())
        else:
            json_obj= []
            print(f"Could not parse LLM output: {text}")

        return json_obj
