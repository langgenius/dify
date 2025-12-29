"""
Validation Rules Definition and Registry.

This module defines:
- ValidationRule: The rule structure
- RuleCategory: Categories of validation rules
- Severity: Error severity levels
- ValidationError: Error output structure
- All built-in validation rules
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

from core.workflow.generator.types import WorkflowNodeDict

if TYPE_CHECKING:
    from core.workflow.generator.validation.context import ValidationContext


class RuleCategory(Enum):
    """Categories of validation rules."""

    STRUCTURE = "structure"  # Field existence, types, formats
    SEMANTIC = "semantic"  # Variable references, edge connections
    REFERENCE = "reference"  # External resources (models, tools, datasets)


class Severity(Enum):
    """Severity levels for validation errors."""

    ERROR = "error"  # Must be fixed
    WARNING = "warning"  # Should be fixed but not blocking


@dataclass
class ValidationError:
    """
    Represents a validation error found during rule execution.

    Attributes:
        rule_id: The ID of the rule that generated this error
        node_id: The ID of the node with the error
        node_type: The type of the node
        category: The rule category
        severity: Error severity
        is_fixable: Whether LLM can auto-fix this error
        message: Human-readable error message
        fix_hint: Hint for LLM to fix the error
        details: Additional error details
    """

    rule_id: str
    node_id: str
    node_type: str
    category: RuleCategory
    severity: Severity
    is_fixable: bool
    message: str
    fix_hint: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "rule_id": self.rule_id,
            "node_id": self.node_id,
            "node_type": self.node_type,
            "category": self.category.value,
            "severity": self.severity.value,
            "is_fixable": self.is_fixable,
            "message": self.message,
            "fix_hint": self.fix_hint,
            "details": self.details,
        }


# Type alias for rule check functions
RuleCheckFn = Callable[
    [WorkflowNodeDict, "ValidationContext"],
    list[ValidationError],
]


@dataclass
class ValidationRule:
    """
    A validation rule definition.

    Attributes:
        id: Unique rule identifier (e.g., "llm.model.required")
        node_types: List of node types this rule applies to, or ["*"] for all
        category: The rule category
        severity: Default severity for errors from this rule
        is_fixable: Whether errors from this rule can be auto-fixed by LLM
        check: The validation function
        description: Human-readable description of what this rule checks
        fix_hint: Default hint for fixing errors from this rule
    """

    id: str
    node_types: list[str]
    category: RuleCategory
    severity: Severity
    is_fixable: bool
    check: RuleCheckFn
    description: str = ""
    fix_hint: str = ""

    def applies_to(self, node_type: str) -> bool:
        """Check if this rule applies to a given node type."""
        return "*" in self.node_types or node_type in self.node_types


# =============================================================================
# Rule Registry
# =============================================================================


class RuleRegistry:
    """
    Registry for validation rules.

    Rules are registered here and can be retrieved by category or node type.
    """

    def __init__(self):
        self._rules: list[ValidationRule] = []

    def register(self, rule: ValidationRule) -> None:
        """Register a validation rule."""
        self._rules.append(rule)

    def get_rules_for_node(self, node_type: str) -> list[ValidationRule]:
        """Get all rules that apply to a given node type."""
        return [r for r in self._rules if r.applies_to(node_type)]

    def get_rules_by_category(self, category: RuleCategory) -> list[ValidationRule]:
        """Get all rules in a given category."""
        return [r for r in self._rules if r.category == category]

    def get_all_rules(self) -> list[ValidationRule]:
        """Get all registered rules."""
        return list(self._rules)


# Global rule registry instance
_registry = RuleRegistry()


def register_rule(rule: ValidationRule) -> ValidationRule:
    """Decorator/function to register a rule with the global registry."""
    _registry.register(rule)
    return rule


def get_registry() -> RuleRegistry:
    """Get the global rule registry."""
    return _registry


# =============================================================================
# Helper Functions for Rule Implementations
# =============================================================================

# Placeholder patterns that indicate user needs to fill in values
PLACEHOLDER_PATTERNS = [
    "PLEASE_SELECT",
    "YOUR_",
    "TODO",
    "PLACEHOLDER",
    "EXAMPLE_",
    "REPLACE_",
    "INSERT_",
    "ADD_YOUR_",
]

# Variable reference pattern: {{#node_id.field#}}
VARIABLE_REF_PATTERN = re.compile(r"\{\{#([^.#]+)\.([^#]+)#\}\}")


def is_placeholder(value: Any) -> bool:
    """Check if a value appears to be a placeholder."""
    if not isinstance(value, str):
        return False
    value_upper = value.upper()
    return any(p in value_upper for p in PLACEHOLDER_PATTERNS)


def extract_variable_refs(text: str) -> list[tuple[str, str]]:
    """
    Extract variable references from text.

    Returns list of (node_id, field_name) tuples.
    """
    return VARIABLE_REF_PATTERN.findall(text)


def check_required_field(
    config: dict[str, Any],
    field_name: str,
    node_id: str,
    node_type: str,
    rule_id: str,
    fix_hint: str = "",
) -> ValidationError | None:
    """Helper to check if a required field exists and is non-empty."""
    value = config.get(field_name)
    if value is None or value == "" or (isinstance(value, list) and len(value) == 0):
        return ValidationError(
            rule_id=rule_id,
            node_id=node_id,
            node_type=node_type,
            category=RuleCategory.STRUCTURE,
            severity=Severity.ERROR,
            is_fixable=True,
            message=f"Node '{node_id}': missing required field '{field_name}'",
            fix_hint=fix_hint or f"Add '{field_name}' to the node config",
        )
    return None


# =============================================================================
# Structure Rules - Field existence, types, formats
# =============================================================================


def _check_llm_prompt_template(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that LLM node has prompt_template."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    config = node.get("config", {})

    err = check_required_field(
        config,
        "prompt_template",
        node_id,
        "llm",
        "llm.prompt_template.required",
        "Add prompt_template with system and user messages",
    )
    if err:
        errors.append(err)

    return errors


def _check_http_request_url(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that http-request node has url and method."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    config = node.get("config", {})

    # Check url
    url = config.get("url", "")
    if not url:
        errors.append(
            ValidationError(
                rule_id="http.url.required",
                node_id=node_id,
                node_type="http-request",
                category=RuleCategory.STRUCTURE,
                severity=Severity.ERROR,
                is_fixable=True,
                message=f"Node '{node_id}': http-request missing required 'url'",
                fix_hint="Add url - use {{#start.url#}} or a concrete URL",
            )
        )
    elif is_placeholder(url):
        errors.append(
            ValidationError(
                rule_id="http.url.placeholder",
                node_id=node_id,
                node_type="http-request",
                category=RuleCategory.STRUCTURE,
                severity=Severity.ERROR,
                is_fixable=True,
                message=f"Node '{node_id}': url contains placeholder value",
                fix_hint="Replace placeholder with actual URL or variable reference",
            )
        )

    # Check method
    method = config.get("method", "")
    if not method:
        errors.append(
            ValidationError(
                rule_id="http.method.required",
                node_id=node_id,
                node_type="http-request",
                category=RuleCategory.STRUCTURE,
                severity=Severity.ERROR,
                is_fixable=True,
                message=f"Node '{node_id}': http-request missing 'method'",
                fix_hint="Add method: GET, POST, PUT, DELETE, or PATCH",
            )
        )

    return errors


def _check_code_node(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that code node has code and language."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    config = node.get("config", {})

    err = check_required_field(
        config,
        "code",
        node_id,
        "code",
        "code.code.required",
        "Add code with a main() function that returns a dict",
    )
    if err:
        errors.append(err)

    err = check_required_field(
        config,
        "language",
        node_id,
        "code",
        "code.language.required",
        "Add language: python3 or javascript",
    )
    if err:
        errors.append(err)

    return errors


def _check_question_classifier(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that question-classifier has classes."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    config = node.get("config", {})

    err = check_required_field(
        config,
        "classes",
        node_id,
        "question-classifier",
        "classifier.classes.required",
        "Add classes array with id and name for each classification",
    )
    if err:
        errors.append(err)

    return errors


def _check_parameter_extractor(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that parameter-extractor has parameters and instruction."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    config = node.get("config", {})

    err = check_required_field(
        config,
        "parameters",
        node_id,
        "parameter-extractor",
        "extractor.parameters.required",
        "Add parameters array with name, type, description fields",
    )
    if err:
        errors.append(err)
    else:
        # Check individual parameters for required fields
        parameters = config.get("parameters", [])
        if isinstance(parameters, list):
            for i, param in enumerate(parameters):
                if isinstance(param, dict):
                    # Check for 'required' field (boolean)
                    if "required" not in param:
                        errors.append(
                            ValidationError(
                                rule_id="extractor.param.required_field.missing",
                                node_id=node_id,
                                node_type="parameter-extractor",
                                category=RuleCategory.STRUCTURE,
                                severity=Severity.ERROR,
                                is_fixable=True,
                                message=f"Node '{node_id}': parameter[{i}] missing 'required' field",
                                fix_hint=f"Add 'required': True to parameter '{param.get('name', 'unknown')}'",
                                details={"param_index": i, "param_name": param.get("name")},
                            )
                        )

    # instruction is recommended but not strictly required
    if not config.get("instruction"):
        errors.append(
            ValidationError(
                rule_id="extractor.instruction.recommended",
                node_id=node_id,
                node_type="parameter-extractor",
                category=RuleCategory.STRUCTURE,
                severity=Severity.WARNING,
                is_fixable=True,
                message=f"Node '{node_id}': parameter-extractor should have 'instruction'",
                fix_hint="Add instruction describing what to extract",
            )
        )

    return errors


def _check_knowledge_retrieval(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that knowledge-retrieval has dataset_ids."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    config = node.get("config", {})

    dataset_ids = config.get("dataset_ids", [])
    if not dataset_ids:
        errors.append(
            ValidationError(
                rule_id="knowledge.dataset.required",
                node_id=node_id,
                node_type="knowledge-retrieval",
                category=RuleCategory.STRUCTURE,
                severity=Severity.ERROR,
                is_fixable=False,  # User must select knowledge base
                message=f"Node '{node_id}': knowledge-retrieval missing 'dataset_ids'",
                fix_hint="User must select knowledge bases in the UI",
            )
        )
    else:
        # Check for placeholder values
        for ds_id in dataset_ids:
            if is_placeholder(ds_id):
                errors.append(
                    ValidationError(
                        rule_id="knowledge.dataset.placeholder",
                        node_id=node_id,
                        node_type="knowledge-retrieval",
                        category=RuleCategory.STRUCTURE,
                        severity=Severity.ERROR,
                        is_fixable=False,
                        message=f"Node '{node_id}': dataset_ids contains placeholder",
                        fix_hint="User must replace placeholder with actual knowledge base ID",
                        details={"placeholder_value": ds_id},
                    )
                )
                break

    return errors


def _check_end_node(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that end node has outputs defined."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    config = node.get("config", {})

    outputs = config.get("outputs", [])
    if not outputs:
        errors.append(
            ValidationError(
                rule_id="end.outputs.recommended",
                node_id=node_id,
                node_type="end",
                category=RuleCategory.STRUCTURE,
                severity=Severity.WARNING,
                is_fixable=True,
                message="End node should define output variables",
                fix_hint="Add outputs array with variable and value_selector",
            )
        )

    return errors


# =============================================================================
# Semantic Rules - Variable references, edge connections
# =============================================================================


def _check_variable_references(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that variable references point to valid nodes."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")
    config = node.get("config", {})

    # Get all valid node IDs (including 'start' which is always valid)
    valid_node_ids = ctx.get_node_ids()
    valid_node_ids.add("start")
    valid_node_ids.add("sys")  # System variables

    def check_text_for_refs(text: str, field_path: str) -> None:
        if not isinstance(text, str):
            return
        refs = extract_variable_refs(text)
        for ref_node_id, ref_field in refs:
            if ref_node_id not in valid_node_ids:
                errors.append(
                    ValidationError(
                        rule_id="variable.ref.invalid_node",
                        node_id=node_id,
                        node_type=node_type,
                        category=RuleCategory.SEMANTIC,
                        severity=Severity.ERROR,
                        is_fixable=True,
                        message=f"Node '{node_id}': references non-existent node '{ref_node_id}'",
                        fix_hint=f"Change {{{{#{ref_node_id}.{ref_field}#}}}} to reference a valid node",
                        details={"field_path": field_path, "invalid_ref": ref_node_id},
                    )
                )

    # Check prompt_template for LLM nodes
    prompt_template = config.get("prompt_template", [])
    if isinstance(prompt_template, list):
        for i, msg in enumerate(prompt_template):
            if isinstance(msg, dict):
                text = msg.get("text", "")
                check_text_for_refs(text, f"prompt_template[{i}].text")

    # Check instruction field
    instruction = config.get("instruction", "")
    check_text_for_refs(instruction, "instruction")

    # Check url for http-request
    url = config.get("url", "")
    check_text_for_refs(url, "url")

    return errors


def _check_node_has_outgoing_edge(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that non-end nodes have at least one outgoing edge."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")

    # End nodes don't need outgoing edges
    if node_type == "end":
        return errors

    # Check if this node has any outgoing edges
    downstream = ctx.get_downstream_nodes(node_id)
    if not downstream:
        errors.append(
            ValidationError(
                rule_id="edge.no_outgoing",
                node_id=node_id,
                node_type=node_type,
                category=RuleCategory.SEMANTIC,
                severity=Severity.ERROR,
                is_fixable=True,
                message=f"Node '{node_id}' has no outgoing edge - workflow is disconnected",
                fix_hint=f"Add an edge from '{node_id}' to the next node or to 'end'",
                details={"field": "edges"},
            )
        )

    return errors


def _check_node_has_incoming_edge(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that non-start nodes have at least one incoming edge."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")

    # Start nodes don't need incoming edges
    if node_type == "start":
        return errors

    # Check if this node has any incoming edges
    upstream = ctx.get_upstream_nodes(node_id)
    if not upstream:
        errors.append(
            ValidationError(
                rule_id="edge.no_incoming",
                node_id=node_id,
                node_type=node_type,
                category=RuleCategory.SEMANTIC,
                severity=Severity.ERROR,
                is_fixable=True,
                message=f"Node '{node_id}' is orphaned - no incoming edges",
                fix_hint=f"Add an edge from a previous node to '{node_id}'",
                details={"field": "edges"},
            )
        )

    return errors


def _check_question_classifier_branches(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that question-classifier has edges for all defined classes."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")

    if node_type != "question-classifier":
        return errors

    config = node.get("config", {})
    classes = config.get("classes", [])

    if not classes:
        return errors  # Already caught by structure validation

    # Get all class IDs
    class_ids = set()
    for cls in classes:
        if isinstance(cls, dict) and cls.get("id"):
            class_ids.add(cls["id"])

    # Get all outgoing edges with their sourceHandles
    outgoing_handles = set()
    for edge in ctx.edges:
        if edge.get("source") == node_id:
            handle = edge.get("sourceHandle")
            if handle:
                outgoing_handles.add(handle)

    # Check for missing branches
    missing_branches = class_ids - outgoing_handles
    if missing_branches:
        for branch_id in missing_branches:
            # Find the class name for better error message
            class_name = branch_id
            for cls in classes:
                if isinstance(cls, dict) and cls.get("id") == branch_id:
                    class_name = cls.get("name", branch_id)
                    break

            errors.append(
                ValidationError(
                    rule_id="edge.classifier_branch.missing",
                    node_id=node_id,
                    node_type=node_type,
                    category=RuleCategory.SEMANTIC,
                    severity=Severity.ERROR,
                    is_fixable=True,
                    message=f"Question classifier '{node_id}' missing edge for class '{class_name}'",
                    fix_hint=f"Add edge: {{source: '{node_id}', sourceHandle: '{branch_id}', target: '<target_node>'}}",
                    details={"missing_class_id": branch_id, "missing_class_name": class_name, "field": "edges"},
                )
            )

    return errors


def _check_if_else_branches(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that if-else has both true and false branch edges."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")

    if node_type != "if-else":
        return errors

    # Get all outgoing edges with their sourceHandles
    outgoing_handles = set()
    for edge in ctx.edges:
        if edge.get("source") == node_id:
            handle = edge.get("sourceHandle")
            if handle:
                outgoing_handles.add(handle)

    # Check for required branches
    required_branches = {"true", "false"}
    missing_branches = required_branches - outgoing_handles

    for branch in missing_branches:
        errors.append(
            ValidationError(
                rule_id="edge.if_else_branch.missing",
                node_id=node_id,
                node_type=node_type,
                category=RuleCategory.SEMANTIC,
                severity=Severity.ERROR,
                is_fixable=True,
                message=f"If-else node '{node_id}' missing '{branch}' branch edge",
                fix_hint=f"Add edge: {{source: '{node_id}', sourceHandle: '{branch}', target: '<target_node>'}}",
                details={"missing_branch": branch, "field": "edges"},
            )
        )

    return errors

    return errors


def _check_if_else_operators(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that if-else comparison operators are valid."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")

    if node_type != "if-else":
        return errors

    valid_operators = {
        "contains",
        "not contains",
        "start with",
        "end with",
        "is",
        "is not",
        "empty",
        "not empty",
        "in",
        "not in",
        "all of",
        "=",
        "≠",
        ">",
        "<",
        "≥",
        "≤",
        "null",
        "not null",
        "exists",
        "not exists",
    }

    config = node.get("config", {})
    cases = config.get("cases", [])

    for case in cases:
        conditions = case.get("conditions", [])
        for condition in conditions:
            op = condition.get("comparison_operator")
            if op and op not in valid_operators:
                errors.append(
                    ValidationError(
                        rule_id="ifelse.operator.invalid",
                        node_id=node_id,
                        node_type=node_type,
                        category=RuleCategory.SEMANTIC,
                        severity=Severity.ERROR,
                        is_fixable=True,
                        message=f"Invalid operator '{op}' in if-else node",
                        fix_hint=f"Use one of: {', '.join(sorted(valid_operators))}",
                        details={"invalid_operator": op, "field": "config.cases.conditions.comparison_operator"},
                    )
                )

    return errors


def _check_edge_targets_exist(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that edge targets reference existing nodes."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")

    valid_node_ids = ctx.get_node_ids()

    # Check all outgoing edges from this node
    for edge in ctx.edges:
        if edge.get("source") == node_id:
            target = edge.get("target")
            if target and target not in valid_node_ids:
                errors.append(
                    ValidationError(
                        rule_id="edge.target.invalid",
                        node_id=node_id,
                        node_type=node_type,
                        category=RuleCategory.SEMANTIC,
                        severity=Severity.ERROR,
                        is_fixable=True,
                        message=f"Edge from '{node_id}' targets non-existent node '{target}'",
                        fix_hint=f"Change edge target from '{target}' to an existing node",
                        details={"invalid_target": target, "field": "edges"},
                    )
                )

    return errors


# =============================================================================
# Reference Rules - External resources (models, tools, datasets)
# =============================================================================

# Node types that require model configuration
MODEL_REQUIRED_NODE_TYPES = {"llm", "question-classifier", "parameter-extractor"}


def _check_model_config(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that model configuration is valid."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")
    config = node.get("config", {})

    if node_type not in MODEL_REQUIRED_NODE_TYPES:
        return errors

    model = config.get("model")

    # Check if model config exists
    if not model:
        if ctx.available_models:
            errors.append(
                ValidationError(
                    rule_id="model.required",
                    node_id=node_id,
                    node_type=node_type,
                    category=RuleCategory.REFERENCE,
                    severity=Severity.ERROR,
                    is_fixable=True,
                    message=f"Node '{node_id}' ({node_type}): missing required 'model' configuration",
                    fix_hint="Add model config using one of the available models",
                )
            )
        else:
            errors.append(
                ValidationError(
                    rule_id="model.no_available",
                    node_id=node_id,
                    node_type=node_type,
                    category=RuleCategory.REFERENCE,
                    severity=Severity.ERROR,
                    is_fixable=False,
                    message=f"Node '{node_id}' ({node_type}): needs model but no models available",
                    fix_hint="User must configure a model provider first",
                )
            )
        return errors

    # Check if model config is valid
    if isinstance(model, dict):
        provider = model.get("provider", "")
        name = model.get("name", "")

        # Check for placeholder values
        if is_placeholder(provider) or is_placeholder(name):
            if ctx.available_models:
                errors.append(
                    ValidationError(
                        rule_id="model.placeholder",
                        node_id=node_id,
                        node_type=node_type,
                        category=RuleCategory.REFERENCE,
                        severity=Severity.ERROR,
                        is_fixable=True,
                        message=f"Node '{node_id}': model config contains placeholder",
                        fix_hint="Replace placeholder with actual model from available_models",
                    )
                )
            return errors

        # Check if model exists in available_models
        if ctx.available_models and provider and name:
            if not ctx.has_model(provider, name):
                errors.append(
                    ValidationError(
                        rule_id="model.not_found",
                        node_id=node_id,
                        node_type=node_type,
                        category=RuleCategory.REFERENCE,
                        severity=Severity.ERROR,
                        is_fixable=True,
                        message=f"Node '{node_id}': model '{provider}/{name}' not in available models",
                        fix_hint="Replace with a model from available_models",
                        details={"provider": provider, "model": name},
                    )
                )

    return errors


def _check_tool_reference(node: WorkflowNodeDict, ctx: "ValidationContext") -> list[ValidationError]:
    """Check that tool references are valid and configured."""
    errors: list[ValidationError] = []
    node_id = node.get("id", "unknown")
    node_type = node.get("type", "unknown")

    if node_type != "tool":
        return errors

    config = node.get("config", {})
    tool_ref = (
        config.get("tool_key")
        or config.get("tool_name")
        or config.get("provider_id", "") + "/" + config.get("tool_name", "")
    )

    if not tool_ref:
        errors.append(
            ValidationError(
                rule_id="tool.key.required",
                node_id=node_id,
                node_type=node_type,
                category=RuleCategory.REFERENCE,
                severity=Severity.ERROR,
                is_fixable=True,
                message=f"Node '{node_id}': tool node missing tool_key",
                fix_hint="Add tool_key from available_tools",
            )
        )
        return errors

    # Check if tool exists
    if not ctx.has_tool(tool_ref):
        errors.append(
            ValidationError(
                rule_id="tool.not_found",
                node_id=node_id,
                node_type=node_type,
                category=RuleCategory.REFERENCE,
                severity=Severity.ERROR,
                is_fixable=True,  # Can be replaced with http-request fallback
                message=f"Node '{node_id}': tool '{tool_ref}' not found",
                fix_hint="Use http-request or code node as fallback",
                details={"tool_ref": tool_ref},
            )
        )
    elif not ctx.is_tool_configured(tool_ref):
        errors.append(
            ValidationError(
                rule_id="tool.not_configured",
                node_id=node_id,
                node_type=node_type,
                category=RuleCategory.REFERENCE,
                severity=Severity.WARNING,
                is_fixable=False,  # User needs to configure
                message=f"Node '{node_id}': tool '{tool_ref}' requires configuration",
                fix_hint="Configure the tool in Tools settings",
                details={"tool_ref": tool_ref},
            )
        )

    return errors


# =============================================================================
# Register All Rules
# =============================================================================

# Structure Rules
register_rule(
    ValidationRule(
        id="llm.prompt_template.required",
        node_types=["llm"],
        category=RuleCategory.STRUCTURE,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_llm_prompt_template,
        description="LLM node must have prompt_template",
        fix_hint="Add prompt_template with system and user messages",
    )
)

register_rule(
    ValidationRule(
        id="http.config.required",
        node_types=["http-request"],
        category=RuleCategory.STRUCTURE,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_http_request_url,
        description="HTTP request node must have url and method",
        fix_hint="Add url and method to config",
    )
)

register_rule(
    ValidationRule(
        id="code.config.required",
        node_types=["code"],
        category=RuleCategory.STRUCTURE,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_code_node,
        description="Code node must have code and language",
        fix_hint="Add code with main() function and language",
    )
)

register_rule(
    ValidationRule(
        id="classifier.classes.required",
        node_types=["question-classifier"],
        category=RuleCategory.STRUCTURE,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_question_classifier,
        description="Question classifier must have classes",
        fix_hint="Add classes array with classification options",
    )
)

register_rule(
    ValidationRule(
        id="extractor.config.required",
        node_types=["parameter-extractor"],
        category=RuleCategory.STRUCTURE,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_parameter_extractor,
        description="Parameter extractor must have parameters",
        fix_hint="Add parameters array",
    )
)

register_rule(
    ValidationRule(
        id="knowledge.config.required",
        node_types=["knowledge-retrieval"],
        category=RuleCategory.STRUCTURE,
        severity=Severity.ERROR,
        is_fixable=False,
        check=_check_knowledge_retrieval,
        description="Knowledge retrieval must have dataset_ids",
        fix_hint="User must select knowledge base",
    )
)

register_rule(
    ValidationRule(
        id="end.outputs.check",
        node_types=["end"],
        category=RuleCategory.STRUCTURE,
        severity=Severity.WARNING,
        is_fixable=True,
        check=_check_end_node,
        description="End node should have outputs",
        fix_hint="Add outputs array",
    )
)

# Semantic Rules
register_rule(
    ValidationRule(
        id="variable.references.valid",
        node_types=["*"],
        category=RuleCategory.SEMANTIC,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_variable_references,
        description="Variable references must point to valid nodes",
        fix_hint="Fix variable reference to use valid node ID",
    )
)

# Edge Validation Rules
register_rule(
    ValidationRule(
        id="edge.outgoing.required",
        node_types=["*"],
        category=RuleCategory.SEMANTIC,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_node_has_outgoing_edge,
        description="Non-end nodes must have outgoing edges",
        fix_hint="Add an edge from this node to the next node",
    )
)

register_rule(
    ValidationRule(
        id="edge.incoming.required",
        node_types=["*"],
        category=RuleCategory.SEMANTIC,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_node_has_incoming_edge,
        description="Non-start nodes must have incoming edges",
        fix_hint="Add an edge from a previous node to this node",
    )
)

register_rule(
    ValidationRule(
        id="edge.classifier_branches.complete",
        node_types=["question-classifier"],
        category=RuleCategory.SEMANTIC,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_question_classifier_branches,
        description="Question classifier must have edges for all classes",
        fix_hint="Add edges with sourceHandle for each class ID",
    )
)

register_rule(
    ValidationRule(
        id="edge.if_else_branches.complete",
        node_types=["if-else"],
        category=RuleCategory.SEMANTIC,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_if_else_branches,
        description="If-else must have true and false branch edges",
        fix_hint="Add edges with sourceHandle 'true' and 'false'",
    )
)

register_rule(
    ValidationRule(
        id="edge.targets.valid",
        node_types=["*"],
        category=RuleCategory.SEMANTIC,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_edge_targets_exist,
        description="Edge targets must reference existing nodes",
        fix_hint="Change edge target to an existing node ID",
    )
)

# Reference Rules
register_rule(
    ValidationRule(
        id="model.config.valid",
        node_types=["llm", "question-classifier", "parameter-extractor"],
        category=RuleCategory.REFERENCE,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_model_config,
        description="Model configuration must be valid",
        fix_hint="Add valid model from available_models",
    )
)

register_rule(
    ValidationRule(
        id="tool.reference.valid",
        node_types=["tool"],
        category=RuleCategory.REFERENCE,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_tool_reference,
        description="Tool reference must be valid and configured",
        fix_hint="Use valid tool or fallback node",
    )
)

register_rule(
    ValidationRule(
        id="ifelse.operator.valid",
        node_types=["if-else"],
        category=RuleCategory.SEMANTIC,
        severity=Severity.ERROR,
        is_fixable=True,
        check=_check_if_else_operators,
        description="If-else operators must be valid",
        fix_hint="Use standard operators like ≥, ≤, =, ≠",
    )
)
