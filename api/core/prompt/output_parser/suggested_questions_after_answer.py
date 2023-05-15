import json
from typing import Any

from langchain.schema import BaseOutputParser
from core.prompt.prompts import SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT


class SuggestedQuestionsAfterAnswerOutputParser(BaseOutputParser):

    def get_format_instructions(self) -> str:
        return SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

    def parse(self, text: str) -> Any:
        json_string = text.strip()
        json_obj = json.loads(json_string)
        return json_obj
