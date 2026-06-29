from __future__ import annotations

import enum


class HumanInputFormStatus(enum.StrEnum):
    """Status of a human input form persisted by Dify."""

    WAITING = enum.auto()
    EXPIRED = enum.auto()
    SUBMITTED = enum.auto()
    TIMEOUT = enum.auto()


class HumanInputFormKind(enum.StrEnum):
    """Kind of human input form tracked by Dify."""

    RUNTIME = enum.auto()
    DELIVERY_TEST = enum.auto()


class ButtonStyle(enum.StrEnum):
    PRIMARY = enum.auto()
    DEFAULT = enum.auto()
    ACCENT = enum.auto()
    GHOST = enum.auto()


class TimeoutUnit(enum.StrEnum):
    HOUR = enum.auto()
    DAY = enum.auto()


class FormInputType(enum.StrEnum):
    PARAGRAPH = "paragraph"
    SELECT = "select"
    FILE = "file"
    FILE_LIST = "file-list"


class ValueSourceType(enum.StrEnum):
    VARIABLE = enum.auto()
    CONSTANT = enum.auto()


__all__ = [
    "ButtonStyle",
    "FormInputType",
    "HumanInputFormKind",
    "HumanInputFormStatus",
    "TimeoutUnit",
    "ValueSourceType",
]
