import json
import logging
import re
from collections.abc import Sequence

from core.llm_generator.prompts import DEFAULT_SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

logger = logging.getLogger(__name__)

_THINK_TAG_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _strip_reasoning_blocks(text: str) -> str:
    stripped = _THINK_TAG_RE.sub("", text)
    open_tag = "<think>"
    lower = stripped.lower()
    while True:
        open_idx = lower.find(open_tag)
        if open_idx == -1:
            break
        tail = stripped[open_idx + len(open_tag) :]
        array_start = tail.find("[")
        if array_start != -1:
            stripped = tail[array_start:]
            lower = stripped.lower()
            break
        stripped = stripped[:open_idx]
        lower = stripped.lower()
    return stripped.strip()


class SuggestedQuestionsAfterAnswerOutputParser:
    def __init__(self, instruction_prompt: str | None = None) -> None:
        self._instruction_prompt = self._build_instruction_prompt(instruction_prompt)

    @staticmethod
    def _build_instruction_prompt(instruction_prompt: str | None) -> str:
        if not instruction_prompt or not instruction_prompt.strip():
            return DEFAULT_SUGGESTED_QUESTIONS_AFTER_ANSWER_INSTRUCTION_PROMPT

        return f'{instruction_prompt}\nYou must output a JSON array like ["question1", "question2", "question3"].'

    def get_format_instructions(self) -> str:
        return self._instruction_prompt

    def parse(self, text: str) -> Sequence[str]:
        stripped_text = _strip_reasoning_blocks(text)
        action_match = re.search(r"\[.*?\]", stripped_text, re.DOTALL)
        questions: list[str] = []
        if action_match is not None:
            try:
                json_obj = json.loads(action_match.group(0).strip())
            except json.JSONDecodeError as exc:
                logger.warning("Failed to decode suggested questions payload: %s", exc)
            else:
                if isinstance(json_obj, list):
                    questions = [question for question in json_obj if isinstance(question, str)]
        elif stripped_text:
            logger.warning("Failed to find suggested questions payload array in text: %r", stripped_text[:200])
        return questions
