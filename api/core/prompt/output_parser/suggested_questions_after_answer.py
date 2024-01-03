import json
import re
from typing import Any

from langchain.schema import BaseOutputParser

from core.model_runtime.errors.invoke import InvokeError
from core.prompt.prompts import SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT


class SuggestedQuestionsAfterAnswerOutputParser(BaseOutputParser):

    def get_format_instructions(self) -> str:
        return SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

    def parse(self, text: str) -> Any:
        json_string = text.strip()
        action_match = re.search(r".*(\[\".+\"\]).*", json_string, re.DOTALL)
        if action_match is not None:
            json_obj = json.loads(action_match.group(1).strip(), strict=False)
        else:
            raise InvokeError("Could not parse LLM output: {text}")

        return json_obj
