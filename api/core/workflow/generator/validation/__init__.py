"""
Validation Rule Engine for Vibe Workflow Generation.

This module provides a declarative, schema-based validation system for
generated workflow nodes. It classifies errors into fixable (LLM can auto-fix)
and user-required (needs manual intervention) categories.

Usage:
    from core.workflow.generator.validation import ValidationEngine, ValidationContext

    context = ValidationContext(
        available_models=[...],
        available_tools=[...],
        nodes=[...],
        edges=[...],
    )
    engine = ValidationEngine()
    result = engine.validate(context)

    # Access classified errors
    fixable_errors = result.fixable_errors
    user_required_errors = result.user_required_errors
"""

from core.workflow.generator.validation.context import ValidationContext
from core.workflow.generator.validation.engine import ValidationEngine, ValidationResult
from core.workflow.generator.validation.rules import (
    RuleCategory,
    Severity,
    ValidationError,
    ValidationRule,
)

__all__ = [
    "RuleCategory",
    "Severity",
    "ValidationContext",
    "ValidationEngine",
    "ValidationError",
    "ValidationResult",
    "ValidationRule",
]



