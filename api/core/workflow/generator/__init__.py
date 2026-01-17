"""
Vibe Workflow Generator Package.

This package provides AI-powered workflow generation capabilities,
converting natural language descriptions into executable Dify workflows.

Main Components:
- WorkflowGenerator: Main entry point for workflow generation
- Types: Unified type definitions and constants
- Strategies: Retry and output handling strategies
- Validation: Rule-based workflow validation
- Utils: Graph validation, edge repair, and node repair utilities
"""

from .runner import WorkflowGenerator

__all__ = ["WorkflowGenerator"]
