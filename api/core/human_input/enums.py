"""Channel-neutral Human Input enumerations."""

import enum


class ButtonStyle(enum.StrEnum):
    """Button styles for user actions."""

    PRIMARY = enum.auto()
    DEFAULT = enum.auto()
    ACCENT = enum.auto()
    GHOST = enum.auto()
