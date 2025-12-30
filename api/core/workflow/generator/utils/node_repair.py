"""
Node Repair Utility for Vibe Workflow Generation.

This module provides intelligent node configuration repair capabilities.
It can detect and fix common node configuration issues:
- Invalid comparison operators in if-else nodes (e.g. '>=' -> '≥')
"""

import copy
import logging
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

    @classmethod
    def repair(cls, nodes: list[WorkflowNodeDict]) -> NodeRepairResult:
        """
        Repair node configurations.

        Args:
            nodes: List of node dictionaries

        Returns:
            NodeRepairResult with repaired nodes and logs
        """
        # Deep copy to avoid mutating original
        nodes = copy.deepcopy(nodes)
        repairs: list[str] = []
        warnings: list[str] = []

        for node in nodes:
            node_type = node.get("type")
            node_id = node.get("id", "unknown")

            if node_type == "if-else":
                cls._repair_if_else_operators(node, repairs)

            if node_type == "variable-aggregator":
                cls._repair_variable_aggregator_variables(node, repairs)

            if node_type == "code":
                cls._repair_code_node_outputs(node, repairs)

            # Add other node type repairs here as needed

        return NodeRepairResult(
            nodes=nodes,
            repairs_made=repairs,
            warnings=warnings,
        )

    @classmethod
    def _repair_if_else_operators(cls, node: WorkflowNodeDict, repairs: list[str]):
        """
        Normalize comparison operators in if-else nodes.
        """
        node_id = node.get("id", "unknown")
        config = node.get("config", {})
        cases = config.get("cases", [])

        for case in cases:
            conditions = case.get("conditions", [])
            for condition in conditions:
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
    def _repair_code_node_outputs(cls, node: WorkflowNodeDict, repairs: list[str]):
        """
        Repair code node outputs format.
        Converts list format to dict format.
        Expected: {"var_name": {"type": "string"}}
        May receive: [{"variable": "var_name", "type": "string"}]
        """
        node_id = node.get("id", "unknown")
        config = node.get("config", {})
        outputs = config.get("outputs")

        if not outputs or isinstance(outputs, dict):
            return

        if isinstance(outputs, list):
            new_outputs = {}
            for item in outputs:
                if isinstance(item, dict):
                    var_name = item.get("variable") or item.get("name")
                    var_type = item.get("type")
                    if var_name and var_type:
                        new_outputs[var_name] = {"type": var_type}

            if new_outputs:
                config["outputs"] = new_outputs
                repairs.append(f"Repaired code node outputs format in node '{node_id}'")
            else:
                # If conversion failed (e.g. empty list or invalid items), set to empty dict
                config["outputs"] = {}
                repairs.append(f"Reset invalid code node outputs to empty dict in node '{node_id}'")
