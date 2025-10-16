"""
Domain-level exceptions for message operations.
"""


class MessageError(Exception):
    """Base exception for message-related errors."""


class MessageNotFoundError(MessageError):
    """Raised when a message cannot be found."""


class FirstMessageNotFoundError(MessageNotFoundError):
    """Raised when the first message for pagination cannot be found."""


class LastMessageNotFoundError(MessageNotFoundError):
    """Raised when the last message for pagination cannot be found."""
