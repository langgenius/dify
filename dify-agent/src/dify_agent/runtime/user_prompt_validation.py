"""Validation for effective user prompts produced by Agenton compositors.

Validation happens after safe compositor construction so scheduler and runner
paths use the same semantics as the actual pydantic-ai input. Blank string fragments do not
count as meaningful input; non-string ``UserContent`` is treated as intentional
content because rich media/message parts do not have a universal whitespace
representation.
"""

from collections.abc import Sequence

from pydantic_ai.messages import UserContent


EMPTY_USER_PROMPTS_ERROR = "compositor.user_prompts must not be empty"


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
