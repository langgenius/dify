"""
Layer system for GraphEngine extensibility.

This module provides the layer infrastructure for extending GraphEngine functionality
with middleware-like components that can observe events and interact with execution.
"""

from .base import Layer
from .debug_logging import DebugLoggingLayer
from .execution_limits import ExecutionLimitsLayer

__all__ = [
    "DebugLoggingLayer",
    "ExecutionLimitsLayer",
    "Layer",
]
