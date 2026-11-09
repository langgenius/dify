"""Layer system for Engine extensibility.

This module provides the layer infrastructure for extending Engine functionality
with middleware-like components that can observe events and interact with execution.
"""

from .base import Layer
from .builtin.execution_limits import ExecutionLimitsLayer

__all__ = [
    "ExecutionLimitsLayer",
    "Layer",
]
