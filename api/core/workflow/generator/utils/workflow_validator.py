import logging
from dataclasses import dataclass

from core.workflow.generator.types import AvailableModelDict, AvailableToolDict, WorkflowDataDict
from core.workflow.generator.validation.context import ValidationContext
from core.workflow.generator.validation.engine import ValidationEngine
from core.workflow.generator.validation.rules import Severity

logger = logging.getLogger(__name__)


@dataclass
class ValidationHint:
    """Legacy compatibility class for validation hints."""

    node_id: str
    field: str
    message: str
    severity: str  # 'error', 'warning'
    suggestion: str = None
    node_type: str = None  # Added for test compatibility

    # Alias for potential old code using 'type' instead of 'severity'
    @property
    def type(self) -> str:
        return self.severity

    @property
    def element_id(self) -> str:
        return self.node_id


FriendlyHint = ValidationHint  # Alias for backward compatibility


class WorkflowValidator:
    """
    Validates the generated workflow configuration (nodes and edges).
    Wraps the new ValidationEngine for backward compatibility.
    """

    @classmethod
    def validate(
        cls,
        workflow_data: WorkflowDataDict,
        available_tools: list[AvailableToolDict],
        available_models: list[AvailableModelDict] | None = None,
    ) -> tuple[bool, list[ValidationHint]]:
        """
        Validate workflow data and return validity status and hints.

        Args:
            workflow_data: Dict containing 'nodes' and 'edges'
            available_tools: List of available tool configurations
            available_models: List of available models (added for Vibe compat)

        Returns:
            Tuple(max_severity_is_not_error, list_of_hints)
        """
        nodes = workflow_data.get("nodes", [])
        edges = workflow_data.get("edges", [])

        # Create context
        context = ValidationContext(
            nodes=nodes,
            edges=edges,
            available_models=available_models or [],
            available_tools=available_tools or [],
        )

        # Run validation engine
        engine = ValidationEngine()
        result = engine.validate(context)

        # Convert engine errors to legacy hints
        hints: list[ValidationHint] = []

        for error in result.all_errors:
            # Map severity
            severity = "error" if error.severity == Severity.ERROR else "warning"

            # Map field from message or details if possible (heuristic)
            field_name = error.details.get("field", "unknown")

            hints.append(
                ValidationHint(
                    node_id=error.node_id,
                    field=field_name,
                    message=error.message,
                    severity=severity,
                    suggestion=error.fix_hint,
                    node_type=error.node_type,
                )
            )

        return result.is_valid, hints
