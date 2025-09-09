"""
Error handling for graph engine.

This package provides error handling functionality for managing
node execution failures with different recovery strategies.
"""

from .error_handler import ErrorHandler

__all__ = [
    "ErrorHandler",
]
