import enum


class HumanInputFormStatus(enum.StrEnum):
    """Status of a human input form."""

    WAITING = enum.auto()
    EXPIRED = enum.auto()
    SUBMITTED = enum.auto()
    TIMEOUT = enum.auto()


class DeliveryMethodType(enum.StrEnum):
    """Delivery method types for human input forms."""

    WEBAPP = enum.auto()
    EMAIL = enum.auto()


class ButtonStyle(enum.StrEnum):
    """Button styles for user actions."""

    PRIMARY = enum.auto()
    DEFAULT = enum.auto()
    ACCENT = enum.auto()
    GHOST = enum.auto()


class TimeoutUnit(enum.StrEnum):
    """Timeout unit for form expiration."""

    HOUR = enum.auto()
    DAY = enum.auto()


class FormInputType(enum.StrEnum):
    """Form input types."""

    TEXT_INPUT = enum.auto()
    PARAGRAPH = enum.auto()


class PlaceholderType(enum.StrEnum):
    """Placeholder types for form inputs."""

    VARIABLE = enum.auto()
    CONSTANT = enum.auto()


class EmailRecipientType(enum.StrEnum):
    """Email recipient types."""

    MEMBER = enum.auto()
    EXTERNAL = enum.auto()
