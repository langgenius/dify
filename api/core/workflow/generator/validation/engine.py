"""
Validation Engine - Core validation logic.

The ValidationEngine orchestrates rule execution and aggregates results.
It provides a clean interface for validating workflow nodes.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from core.workflow.generator.types import (
    AvailableModelDict,
    AvailableToolDict,
    WorkflowEdgeDict,
    WorkflowNodeDict,
)
from core.workflow.generator.validation.context import ValidationContext
from core.workflow.generator.validation.rules import (
    RuleCategory,
    Severity,
    ValidationError,
    get_registry,
)

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """
    Result of validation containing all errors classified by fixability.

    Attributes:
        all_errors: All validation errors found
        fixable_errors: Errors that LLM can automatically fix
        user_required_errors: Errors that require user intervention
        warnings: Non-blocking warnings
        stats: Validation statistics
    """

    all_errors: list[ValidationError] = field(default_factory=list)
    fixable_errors: list[ValidationError] = field(default_factory=list)
    user_required_errors: list[ValidationError] = field(default_factory=list)
    warnings: list[ValidationError] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)

    @property
    def has_errors(self) -> bool:
        """Check if there are any errors (excluding warnings)."""
        return len(self.fixable_errors) > 0 or len(self.user_required_errors) > 0

    @property
    def has_fixable_errors(self) -> bool:
        """Check if there are fixable errors."""
        return len(self.fixable_errors) > 0

    @property
    def is_valid(self) -> bool:
        """Check if validation passed (no errors, warnings are OK)."""
        return not self.has_errors

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "fixable": [e.to_dict() for e in self.fixable_errors],
            "user_required": [e.to_dict() for e in self.user_required_errors],
            "warnings": [e.to_dict() for e in self.warnings],
            "all_warnings": [e.message for e in self.all_errors],
            "stats": self.stats,
        }

    def get_error_messages(self) -> list[str]:
        """Get all error messages as strings."""
        return [e.message for e in self.all_errors]

    def get_fixable_by_node(self) -> dict[str, list[ValidationError]]:
        """Group fixable errors by node ID."""
        result: dict[str, list[ValidationError]] = {}
        for error in self.fixable_errors:
            if error.node_id not in result:
                result[error.node_id] = []
            result[error.node_id].append(error)
        return result


class ValidationEngine:
    """
    The main validation engine.

    Usage:
        engine = ValidationEngine()
        context = ValidationContext(nodes=[...], available_models=[...])
        result = engine.validate(context)
    """

    def __init__(self):
        self._registry = get_registry()

    def validate(self, context: ValidationContext) -> ValidationResult:
        """
        Validate all nodes in the context.

        Args:
            context: ValidationContext with nodes, edges, and available resources

        Returns:
            ValidationResult with classified errors
        """
        result = ValidationResult()
        stats = {
            "total_nodes": len(context.nodes),
            "total_rules_checked": 0,
            "total_errors": 0,
            "fixable_count": 0,
            "user_required_count": 0,
            "warning_count": 0,
        }

        # Validate each node
        for node in context.nodes:
            node_type = node.get("type", "unknown")
            node_id = node.get("id", "unknown")

            # Get applicable rules for this node type
            rules = self._registry.get_rules_for_node(node_type)

            for rule in rules:
                stats["total_rules_checked"] += 1

                try:
                    errors = rule.check(node, context)
                    for error in errors:
                        result.all_errors.append(error)
                        stats["total_errors"] += 1

                        # Classify by severity and fixability
                        if error.severity == Severity.WARNING:
                            result.warnings.append(error)
                            stats["warning_count"] += 1
                        elif error.is_fixable:
                            result.fixable_errors.append(error)
                            stats["fixable_count"] += 1
                        else:
                            result.user_required_errors.append(error)
                            stats["user_required_count"] += 1

                except Exception:
                    logger.exception(
                        "Rule '%s' failed for node '%s'",
                        rule.id,
                        node_id,
                    )
                    # Don't let a rule failure break the entire validation
                    continue

        # Validate edges separately
        edge_errors = self._validate_edges(context)
        for error in edge_errors:
            result.all_errors.append(error)
            stats["total_errors"] += 1
            if error.is_fixable:
                result.fixable_errors.append(error)
                stats["fixable_count"] += 1
            else:
                result.user_required_errors.append(error)
                stats["user_required_count"] += 1

        result.stats = stats

        return result

    def _validate_edges(self, context: ValidationContext) -> list[ValidationError]:
        """Validate edge connections."""
        errors: list[ValidationError] = []
        valid_node_ids = context.get_node_ids()

        for edge in context.edges:
            source = edge.get("source", "")
            target = edge.get("target", "")

            if source and source not in valid_node_ids:
                errors.append(
                    ValidationError(
                        rule_id="edge.source.invalid",
                        node_id=source,
                        node_type="edge",
                        category=RuleCategory.SEMANTIC,
                        severity=Severity.ERROR,
                        is_fixable=True,
                        message=f"Edge source '{source}' does not exist",
                        fix_hint="Update edge to reference existing node",
                    )
                )

            if target and target not in valid_node_ids:
                errors.append(
                    ValidationError(
                        rule_id="edge.target.invalid",
                        node_id=target,
                        node_type="edge",
                        category=RuleCategory.SEMANTIC,
                        severity=Severity.ERROR,
                        is_fixable=True,
                        message=f"Edge target '{target}' does not exist",
                        fix_hint="Update edge to reference existing node",
                    )
                )

        return errors

    def validate_single_node(
        self,
        node: WorkflowNodeDict,
        context: ValidationContext,
    ) -> list[ValidationError]:
        """
        Validate a single node.

        Useful for incremental validation when a node is added/modified.
        """
        node_type = node.get("type", "unknown")
        rules = self._registry.get_rules_for_node(node_type)

        errors: list[ValidationError] = []
        for rule in rules:
            try:
                errors.extend(rule.check(node, context))
            except Exception:
                logger.exception("Rule '%s' failed", rule.id)

        return errors


def validate_nodes(
    nodes: list[WorkflowNodeDict],
    edges: list[WorkflowEdgeDict] | None = None,
    available_models: list[AvailableModelDict] | None = None,
    available_tools: list[AvailableToolDict] | None = None,
) -> ValidationResult:
    """
    Convenience function to validate nodes without creating engine/context manually.

    Args:
        nodes: List of workflow nodes to validate
        edges: Optional list of edges
        available_models: Optional list of available models
        available_tools: Optional list of available tools

    Returns:
        ValidationResult with classified errors
    """
    context = ValidationContext(
        nodes=nodes,
        edges=edges or [],
        available_models=available_models or [],
        available_tools=available_tools or [],
    )
    engine = ValidationEngine()
    return engine.validate(context)
