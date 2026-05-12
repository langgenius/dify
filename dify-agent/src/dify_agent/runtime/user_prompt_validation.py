"""Validation for effective user prompts produced by Agenton runs.

Validation happens after safe compositor construction and run entry so scheduler
and runner paths use the same transformed prompts as the actual pydantic-ai
input. Blank string fragments do not count as meaningful input; non-string
``UserContent`` is treated as intentional content because rich media/message
parts do not have a universal whitespace representation.
"""

from collections.abc import Sequence

from pydantic_ai.messages import UserContent


EMPTY_USER_PROMPTS_ERROR = "run.user_prompts must not be empty"


def has_non_blank_user_prompt(user_prompts: Sequence[UserContent]) -> bool:
    """Return whether composed user prompts contain meaningful input."""
    for prompt in user_prompts:
        if isinstance(prompt, str):
            if prompt.strip():
                return True
        else:
            return True
    return False


__all__ = ["EMPTY_USER_PROMPTS_ERROR", "has_non_blank_user_prompt"]
