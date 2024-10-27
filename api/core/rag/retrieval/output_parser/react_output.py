from __future__ import annotations

from dataclasses import dataclass
from typing import NamedTuple, Union


@dataclass
class ReactAction:
    """A full description of an action for an ReactAction to execute."""

    tool: str
    """The name of the Tool to execute."""
    tool_input: Union[str, dict]
    """The input to pass in to the Tool."""
    log: str
    """Additional information to log about the action."""


class ReactFinish(NamedTuple):
    """The final return value of an ReactFinish."""

    return_values: dict
    """Dictionary of return values."""
    log: str
    """Additional information to log about the return value"""
