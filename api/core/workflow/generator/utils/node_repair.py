"""
Node Repair Utility for Vibe Workflow Generation.

This module provides intelligent node configuration repair capabilities.
It can detect and fix common node configuration issues:
- Invalid comparison operators in if-else nodes (e.g. '>=' -> '≥')
"""

import copy
import logging
import uuid
from dataclasses import dataclass, field

from core.workflow.generator.types import WorkflowNodeDict

logger = logging.getLogger(__name__)


@dataclass
class NodeRepairResult:
    """Result of node repair operation."""

    nodes: list[WorkflowNodeDict]
    repairs_made: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def was_repaired(self) -> bool:
        """Check if any repairs were made."""
        return len(self.repairs_made) > 0


class NodeRepair:
    """
    Intelligent node configuration repair.
    """

    OPERATOR_MAP = {
        ">=": "≥",
        "<=": "≤",
        "!=": "≠",
        "==": "=",
    }

    TYPE_MAPPING = {
        "json": "object",
        "dict": "object",
        "dictionary": "object",
        "float": "number",
        "int": "number",
        "integer": "number",
        "double": "number",
        "str": "string",
        "text": "string",
        "bool": "boolean",
        "list": "array[object]",
        "array": "array[object]",
    }

    _REPAIR_HANDLERS = {
        "if-else": "_repair_if_else_operators",
        "variable-aggregator": "_repair_variable_aggregator_variables",
        "code": "_repair_code_node_config",
    }

    @classmethod
    def repair(
        cls,
        nodes: list[WorkflowNodeDict],
        llm_callback=None,
    ) -> NodeRepairResult:
        """
        Repair node configurations.

        Args:
            nodes: List of node dictionaries
            llm_callback: Optional callback(node, issue_desc) -> fixed_config_part

        Returns:
            NodeRepairResult with repaired nodes and logs
        """
        # Deep copy to avoid mutating original
        nodes = copy.deepcopy(nodes)
        repairs: list[str] = []
        warnings: list[str] = []

        logger.info("[NODE REPAIR] Starting repair process for %s nodes", len(nodes))

        for node in nodes:
            node_type = node.get("type")

            # 1. Rule-based repairs
            handler_name = cls._REPAIR_HANDLERS.get(node_type)
            if handler_name:
                handler = getattr(cls, handler_name)
                # Check if handler accepts llm_callback (inspect signature or just pass generic kwargs?)
                # Simplest for now: handlers signature: (node, repairs, llm_callback=None)
                try:
                    handler(node, repairs, llm_callback=llm_callback)
                except TypeError:
                    # Fallback for handlers that don't accept llm_callback yet
                    handler(node, repairs)

            # Add other node type repairs here as needed

        if repairs:
            logger.info("[NODE REPAIR] Completed with %s repairs:", len(repairs))
            for i, repair in enumerate(repairs, 1):
                logger.info("[NODE REPAIR]   %s. %s", i, repair)
        else:
            logger.info("[NODE REPAIR] Completed - no repairs needed")

        return NodeRepairResult(
            nodes=nodes,
            repairs_made=repairs,
            warnings=warnings,
        )

    @classmethod
    def _repair_if_else_operators(cls, node: WorkflowNodeDict, repairs: list[str], **kwargs):
        """
        Normalize comparison operators in if-else nodes.
        And ensure 'id' field exists for cases and conditions (frontend requirement).
        """
        node_id = node.get("id", "unknown")
        config = node.get("config", {})
        cases = config.get("cases", [])

        for case in cases:
            # Ensure case_id
            if "case_id" not in case:
                case["case_id"] = str(uuid.uuid4())
                repairs.append(f"Generated missing case_id for case in node '{node_id}'")

            conditions = case.get("conditions", [])
            for condition in conditions:
                # Ensure condition id
                if "id" not in condition:
                    condition["id"] = str(uuid.uuid4())
                    # Not logging this repair to avoid clutter, as it's a structural fix

                # Ensure value type (LLM might return int/float, but we need str/bool/list)
                val = condition.get("value")
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    condition["value"] = str(val)
                    repairs.append(f"Coerced numeric value to string in node '{node_id}'")

                op = condition.get("comparison_operator")
                if op in cls.OPERATOR_MAP:
                    new_op = cls.OPERATOR_MAP[op]
                    condition["comparison_operator"] = new_op
                    repairs.append(f"Normalized operator '{op}' to '{new_op}' in node '{node_id}'")

    @classmethod
    def _repair_variable_aggregator_variables(cls, node: WorkflowNodeDict, repairs: list[str]):
        """
        Repair variable-aggregator variables format.
        Converts dict format to list[list[str]] format.
        Expected: [["node_id", "field"], ["node_id2", "field2"]]
        May receive: [{"name": "...", "value_selector": ["node_id", "field"]}, ...]
        """
        node_id = node.get("id", "unknown")
        config = node.get("config", {})
        variables = config.get("variables", [])

        if not variables:
            return

        repaired = False
        repaired_variables = []

        for var in variables:
            if isinstance(var, dict):
                # Convert dict format to array format
                value_selector = var.get("value_selector") or var.get("selector") or var.get("path")
                if isinstance(value_selector, list) and len(value_selector) > 0:
                    repaired_variables.append(value_selector)
                    repaired = True
                else:
                    # Try to extract from name field - LLM may generate {"name": "node_id.field"}
                    name = var.get("name")
                    if isinstance(name, str) and "." in name:
                        # Try to parse "node_id.field" format
                        parts = name.split(".", 1)
                        if len(parts) == 2:
                            repaired_variables.append([parts[0], parts[1]])
                            repaired = True
                        else:
                            logger.warning(
                                "Variable aggregator node '%s' has invalid variable format: %s",
                                node_id,
                                var,
                            )
                            repaired_variables.append([])  # Empty array as fallback
                    else:
                        # If no valid selector or name, skip this variable
                        logger.warning(
                            "Variable aggregator node '%s' has invalid variable format: %s",
                            node_id,
                            var,
                        )
                        # Don't add empty array - skip invalid variables
            elif isinstance(var, list):
                # Already in correct format
                repaired_variables.append(var)
            else:
                # Unknown format, skip
                logger.warning("Variable aggregator node '%s' has unknown variable format: %s", node_id, var)
                # Don't add empty array - skip invalid variables

        if repaired:
            config["variables"] = repaired_variables
            repairs.append(f"Repaired variable-aggregator variables format in node '{node_id}'")

    @classmethod
    def _repair_code_node_config(cls, node: WorkflowNodeDict, repairs: list[str], llm_callback=None):
        """
        Repair code node configuration (outputs and variables).
        1. Outputs: Converts list format to dict format AND normalizes types.
        2. Variables: Ensures value_selector exists.
        """
        node_id = node.get("id", "unknown")
        config = node.get("config", {})

        if "variables" not in config:
            config["variables"] = []

        # --- Repair Variables ---
        variables = config.get("variables")
        if isinstance(variables, list):
            for var in variables:
                if isinstance(var, dict):
                    # Ensure value_selector exists (frontend crashes if missing)
                    if "value_selector" not in var:
                        var["value_selector"] = []
                        # Not logging trivial repairs

        # --- Repair Outputs ---
        outputs = config.get("outputs")

        if not outputs:
            return

        # Helper to normalize type
        def normalize_type(t: str) -> str:
            t_lower = str(t).lower()
            return cls.TYPE_MAPPING.get(t_lower, t)

        # 1. Handle Dict format (Standard) - Check for invalid types
        if isinstance(outputs, dict):
            changed = False
            for var_name, var_config in outputs.items():
                if isinstance(var_config, dict):
                    original_type = var_config.get("type")
                    if original_type:
                        new_type = normalize_type(original_type)
                        if new_type != original_type:
                            var_config["type"] = new_type
                            changed = True
                            repairs.append(
                                f"Normalized type '{original_type}' to '{new_type}' "
                                f"for var '{var_name}' in node '{node_id}'"
                            )
            return

        # 2. Handle List format (Repair needed)
        if isinstance(outputs, list):
            new_outputs = {}
            for item in outputs:
                if isinstance(item, dict):
                    var_name = item.get("variable") or item.get("name")
                    var_type = item.get("type")
                    if var_name and var_type:
                        norm_type = normalize_type(var_type)
                        new_outputs[var_name] = {"type": norm_type}
                        if norm_type != var_type:
                            repairs.append(
                                f"Normalized type '{var_type}' to '{norm_type}' "
                                f"during list conversion in node '{node_id}'"
                            )

            if new_outputs:
                config["outputs"] = new_outputs
                repairs.append(f"Repaired code node outputs format in node '{node_id}'")
            else:
                # Fallback: Try LLM if available
                if llm_callback:
                    try:
                        # Attempt to fix using LLM
                        fixed_outputs = llm_callback(
                            node,
                            "outputs must be a dictionary like {'var_name': {'type': 'string'}}, "
                            "but got a list or valid conversion failed.",
                        )
                        if isinstance(fixed_outputs, dict) and fixed_outputs:
                            config["outputs"] = fixed_outputs
                            repairs.append(f"Repaired code node outputs format using LLM in node '{node_id}'")
                            return
                    except Exception as e:
                        logger.warning("LLM fallback repair failed for node '%s': %s", node_id, e)

                # If conversion/LLM failed, set to empty dict
                config["outputs"] = {}
                repairs.append(f"Reset invalid code node outputs to empty dict in node '{node_id}'")
