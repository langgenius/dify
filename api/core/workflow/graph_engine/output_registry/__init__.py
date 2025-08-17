"""
OutputRegistry - Thread-safe storage for node outputs (streams and scalars)

This component provides thread-safe storage and retrieval of node outputs,
supporting both scalar values and streaming chunks with proper state management.
"""

from .registry import OutputRegistry

__all__ = ["OutputRegistry"]
