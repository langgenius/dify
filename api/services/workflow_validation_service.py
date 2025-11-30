"""
Workflow Validation Service for Dify.

This module provides comprehensive validation utilities for workflow configurations,
node connections, variable references, and execution constraints. It helps ensure
workflow integrity before execution and provides detailed error reporting.

Key Features:
- Node configuration validation
- Variable reference validation
- Connection graph validation
- Cycle detection in workflow graphs
- Resource limit validation
- Input/output type compatibility checking
"""

from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ValidationSeverity(StrEnum):
    """Severity levels for validation issues."""

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class ValidationCategory(StrEnum):
    """Categories of validation issues."""

    NODE_CONFIG = "node_config"
    CONNECTION = "connection"
    VARIABLE = "variable"
    RESOURCE = "resource"
    STRUCTURE = "structure"
    TYPE_MISMATCH = "type_mismatch"


@dataclass
class ValidationIssue:
    """Represents a single validation issue found in a workflow."""

    severity: ValidationSeverity
    category: ValidationCategory
    node_id: str | None
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "severity": self.severity.value,
            "category": self.category.value,
            "node_id": self.node_id,
            "message": self.message,
            "details": self.details,
        }


@dataclass
class ValidationResult:
    """Result of workflow validation containing all issues found."""

    is_valid: bool
    issues: list[ValidationIssue] = field(default_factory=list)
    warnings_count: int = 0
    errors_count: int = 0

    def add_issue(self, issue: ValidationIssue) -> None:
        """Add a validation issue to the result."""
        self.issues.append(issue)
        if issue.severity == ValidationSeverity.ERROR:
            self.errors_count += 1
            self.is_valid = False
        elif issue.severity == ValidationSeverity.WARNING:
            self.warnings_count += 1

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "is_valid": self.is_valid,
            "errors_count": self.errors_count,
            "warnings_count": self.warnings_count,
            "issues": [issue.to_dict() for issue in self.issues],
        }


class NodeTypeConfig(BaseModel):
    """Configuration schema for a node type."""

    node_type: str
    required_fields: list[str] = Field(default_factory=list)
    optional_fields: list[str] = Field(default_factory=list)
    max_inputs: int = -1
    max_outputs: int = -1
    allows_multiple_connections: bool = True


class WorkflowValidationService:
    """
    Service for validating workflow configurations.

    This service provides methods to validate various aspects of a workflow
    including node configurations, connections, variable references, and
    structural integrity.
    """

    # Node type configurations
    NODE_TYPE_CONFIGS: dict[str, NodeTypeConfig] = {
        "start": NodeTypeConfig(
            node_type="start",
            required_fields=[],
            max_inputs=0,
            max_outputs=1,
        ),
        "end": NodeTypeConfig(
            node_type="end",
            required_fields=["outputs"],
            max_inputs=-1,
            max_outputs=0,
        ),
        "llm": NodeTypeConfig(
            node_type="llm",
            required_fields=["model", "prompt_template"],
            optional_fields=["memory", "context", "vision"],
        ),
        "knowledge-retrieval": NodeTypeConfig(
            node_type="knowledge-retrieval",
            required_fields=["dataset_ids", "query_variable"],
            optional_fields=["retrieval_mode", "top_k", "score_threshold"],
        ),
        "if-else": NodeTypeConfig(
            node_type="if-else",
            required_fields=["conditions"],
            max_outputs=2,
        ),
        "code": NodeTypeConfig(
            node_type="code",
            required_fields=["code", "code_language"],
            optional_fields=["variables"],
        ),
        "template-transform": NodeTypeConfig(
            node_type="template-transform",
            required_fields=["template"],
            optional_fields=["variables"],
        ),
        "question-classifier": NodeTypeConfig(
            node_type="question-classifier",
            required_fields=["model", "classes"],
            optional_fields=["query_variable"],
        ),
        "http-request": NodeTypeConfig(
            node_type="http-request",
            required_fields=["method", "url"],
            optional_fields=["headers", "body", "timeout"],
        ),
        "tool": NodeTypeConfig(
            node_type="tool",
            required_fields=["provider_id", "tool_name"],
            optional_fields=["tool_parameters"],
        ),
        "variable-aggregator": NodeTypeConfig(
            node_type="variable-aggregator",
            required_fields=["variables"],
        ),
        "variable-assigner": NodeTypeConfig(
            node_type="variable-assigner",
            required_fields=["assigned_variable_selector", "input_variable_selector"],
        ),
        "iteration": NodeTypeConfig(
            node_type="iteration",
            required_fields=["iterator_selector"],
            optional_fields=["output_selector", "max_iterations"],
        ),
        "loop": NodeTypeConfig(
            node_type="loop",
            required_fields=["loop_condition"],
            optional_fields=["max_iterations", "break_condition"],
        ),
        "parameter-extractor": NodeTypeConfig(
            node_type="parameter-extractor",
            required_fields=["model", "parameters"],
            optional_fields=["query", "instruction"],
        ),
        "answer": NodeTypeConfig(
            node_type="answer",
            required_fields=["answer"],
        ),
    }

    # Maximum limits for workflow resources
    MAX_NODES = 200
    MAX_CONNECTIONS = 500
    MAX_VARIABLES = 1000
    MAX_NESTING_DEPTH = 10

    @classmethod
    def validate_workflow(cls, workflow_data: dict[str, Any]) -> ValidationResult:
        """
        Perform comprehensive validation of a workflow.

        Args:
            workflow_data: The workflow configuration to validate

        Returns:
            ValidationResult containing all issues found
        """
        result = ValidationResult(is_valid=True)

        # Extract workflow components
        nodes = workflow_data.get("nodes", [])
        edges = workflow_data.get("edges", [])

        # Run all validations
        cls._validate_resource_limits(nodes, edges, result)
        cls._validate_node_configurations(nodes, result)
        cls._validate_connections(nodes, edges, result)
        cls._validate_graph_structure(nodes, edges, result)
        cls._validate_variable_references(nodes, result)

        return result

    @classmethod
    def _validate_resource_limits(
        cls,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        result: ValidationResult,
    ) -> None:
        """Validate that workflow doesn't exceed resource limits."""
        if len(nodes) > cls.MAX_NODES:
            result.add_issue(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    category=ValidationCategory.RESOURCE,
                    node_id=None,
                    message=f"Workflow exceeds maximum node limit of {cls.MAX_NODES}",
                    details={"current_count": len(nodes), "max_allowed": cls.MAX_NODES},
                )
            )

        if len(edges) > cls.MAX_CONNECTIONS:
            result.add_issue(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    category=ValidationCategory.RESOURCE,
                    node_id=None,
                    message=f"Workflow exceeds maximum connection limit of {cls.MAX_CONNECTIONS}",
                    details={"current_count": len(edges), "max_allowed": cls.MAX_CONNECTIONS},
                )
            )

    @classmethod
    def _validate_node_configurations(
        cls,
        nodes: list[dict[str, Any]],
        result: ValidationResult,
    ) -> None:
        """Validate individual node configurations."""
        node_ids = set()

        for node in nodes:
            node_id = node.get("id")
            node_type = node.get("data", {}).get("type")
            node_data = node.get("data", {})

            # Check for duplicate node IDs
            if node_id in node_ids:
                result.add_issue(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        category=ValidationCategory.NODE_CONFIG,
                        node_id=node_id,
                        message=f"Duplicate node ID: {node_id}",
                    )
                )
            node_ids.add(node_id)

            # Validate node type exists
            if not node_type:
                result.add_issue(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        category=ValidationCategory.NODE_CONFIG,
                        node_id=node_id,
                        message="Node is missing type",
                    )
                )
                continue

            # Validate against node type config
            config = cls.NODE_TYPE_CONFIGS.get(node_type)
            if config and node_id:
                cls._validate_node_against_config(node_id, node_data, config, result)

    @classmethod
    def _validate_node_against_config(
        cls,
        node_id: str | None,
        node_data: dict[str, Any],
        config: NodeTypeConfig,
        result: ValidationResult,
    ) -> None:
        """Validate a node against its type configuration."""
        for required_field in config.required_fields:
            if required_field not in node_data or node_data[required_field] is None:
                result.add_issue(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        category=ValidationCategory.NODE_CONFIG,
                        node_id=node_id,
                        message=f"Missing required field: {required_field}",
                        details={"field": required_field, "node_type": config.node_type},
                    )
                )

    @classmethod
    def _validate_connections(
        cls,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        result: ValidationResult,
    ) -> None:
        """Validate workflow connections."""
        node_ids = {node.get("id") for node in nodes}
        node_types = {node.get("id"): node.get("data", {}).get("type") for node in nodes}

        # Track connection counts
        input_counts: dict[str, int] = defaultdict(int)
        output_counts: dict[str, int] = defaultdict(int)

        for edge in edges:
            source = edge.get("source")
            target = edge.get("target")

            # Validate source and target exist
            if source not in node_ids:
                result.add_issue(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        category=ValidationCategory.CONNECTION,
                        node_id=source,
                        message=f"Connection source node not found: {source}",
                    )
                )

            if target not in node_ids:
                result.add_issue(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        category=ValidationCategory.CONNECTION,
                        node_id=target,
                        message=f"Connection target node not found: {target}",
                    )
                )

            # Track counts
            if source:
                output_counts[source] += 1
            if target:
                input_counts[target] += 1

        # Validate connection limits based on node types
        for nid, node_type in node_types.items():
            if not nid:
                continue
            config = cls.NODE_TYPE_CONFIGS.get(node_type)
            if config:
                if config.max_inputs >= 0 and input_counts[nid] > config.max_inputs:
                    result.add_issue(
                        ValidationIssue(
                            severity=ValidationSeverity.ERROR,
                            category=ValidationCategory.CONNECTION,
                            node_id=nid,
                            message="Node exceeds maximum input connections",
                            details={
                                "current": input_counts[nid],
                                "max": config.max_inputs,
                            },
                        )
                    )

                if config.max_outputs >= 0 and output_counts[nid] > config.max_outputs:
                    result.add_issue(
                        ValidationIssue(
                            severity=ValidationSeverity.ERROR,
                            category=ValidationCategory.CONNECTION,
                            node_id=nid,
                            message="Node exceeds maximum output connections",
                            details={
                                "current": output_counts[nid],
                                "max": config.max_outputs,
                            },
                        )
                    )

    @classmethod
    def _validate_graph_structure(
        cls,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        result: ValidationResult,
    ) -> None:
        """Validate the overall graph structure including cycle detection."""
        # Build adjacency list
        graph: dict[str, list[str]] = defaultdict(list)
        for edge in edges:
            source = edge.get("source")
            target = edge.get("target")
            if source and target:
                graph[source].append(target)

        # Check for cycles using DFS
        node_ids = [node.get("id") for node in nodes]
        visited: set[str] = set()
        rec_stack: set[str] = set()

        def has_cycle(node: str) -> bool:
            visited.add(node)
            rec_stack.add(node)

            for neighbor in graph.get(node, []):
                if neighbor not in visited:
                    if has_cycle(neighbor):
                        return True
                elif neighbor in rec_stack:
                    return True

            rec_stack.remove(node)
            return False

        for node_id in node_ids:
            if node_id and node_id not in visited:
                if has_cycle(node_id):
                    result.add_issue(
                        ValidationIssue(
                            severity=ValidationSeverity.ERROR,
                            category=ValidationCategory.STRUCTURE,
                            node_id=None,
                            message="Workflow contains a cycle which is not allowed",
                        )
                    )
                    break

        # Check for start node
        start_nodes = [n for n in nodes if n.get("data", {}).get("type") == "start"]
        if len(start_nodes) == 0:
            result.add_issue(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    category=ValidationCategory.STRUCTURE,
                    node_id=None,
                    message="Workflow must have exactly one start node",
                )
            )
        elif len(start_nodes) > 1:
            result.add_issue(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    category=ValidationCategory.STRUCTURE,
                    node_id=None,
                    message="Workflow cannot have multiple start nodes",
                    details={"start_node_count": len(start_nodes)},
                )
            )

    @classmethod
    def _validate_variable_references(
        cls,
        nodes: list[dict[str, Any]],
        result: ValidationResult,
    ) -> None:
        """Validate variable references across nodes."""
        # Collect all defined variables
        defined_variables: set[str] = set()

        for node in nodes:
            node_id = node.get("id")
            node_data = node.get("data", {})

            # Add outputs as defined variables
            outputs = node_data.get("outputs", [])
            if isinstance(outputs, list):
                for output in outputs:
                    if isinstance(output, dict):
                        var_name = output.get("variable")
                        if var_name:
                            defined_variables.add(f"{node_id}.{var_name}")

        # Check variable count limit
        if len(defined_variables) > cls.MAX_VARIABLES:
            result.add_issue(
                ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    category=ValidationCategory.RESOURCE,
                    node_id=None,
                    message=f"Workflow has many variables ({len(defined_variables)}), consider simplifying",
                    details={"variable_count": len(defined_variables)},
                )
            )

    @classmethod
    def validate_node_update(
        cls,
        node_type: str,
        node_data: dict[str, Any],
    ) -> ValidationResult:
        """
        Validate a single node configuration update.

        Args:
            node_type: The type of node being updated
            node_data: The new node configuration data

        Returns:
            ValidationResult for the node update
        """
        result = ValidationResult(is_valid=True)

        config = cls.NODE_TYPE_CONFIGS.get(node_type)
        if not config:
            result.add_issue(
                ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    category=ValidationCategory.NODE_CONFIG,
                    node_id=None,
                    message=f"Unknown node type: {node_type}",
                )
            )
            return result

        cls._validate_node_against_config(None, node_data, config, result)
        return result

    @classmethod
    def get_node_type_schema(cls, node_type: str) -> dict[str, Any] | None:
        """
        Get the configuration schema for a node type.

        Args:
            node_type: The node type to get schema for

        Returns:
            Schema dictionary or None if type not found
        """
        config = cls.NODE_TYPE_CONFIGS.get(node_type)
        if not config:
            return None

        return {
            "node_type": config.node_type,
            "required_fields": config.required_fields,
            "optional_fields": config.optional_fields,
            "max_inputs": config.max_inputs,
            "max_outputs": config.max_outputs,
            "allows_multiple_connections": config.allows_multiple_connections,
        }

    @classmethod
    def list_supported_node_types(cls) -> list[str]:
        """Get list of all supported node types."""
        return list(cls.NODE_TYPE_CONFIGS.keys())
