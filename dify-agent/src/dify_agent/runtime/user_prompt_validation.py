"""Validation for effective user input assembled from module configuration.

The runner validates assembled current prompt content before resource acquisition.
Knowledge user-query retrieval can also provide input through its native hook.
Blank string fragments do not count as meaningful input; non-string
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
