"""
Node Repair Utility for Vibe Workflow Generation.

This module provides intelligent node configuration repair capabilities.
It can detect and fix common node configuration issues:
- Invalid comparison operators in if-else nodes (e.g. '>=' -> '≥')
"""

import copy
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class NodeRepairResult:
    """Result of node repair operation."""

    nodes: list[dict[str, Any]]
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
    def repair(cls, nodes: list[dict[str, Any]]) -> NodeRepairResult:
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

            if node_type == "if-else":
                cls._repair_if_else_operators(node, repairs)

            # Add other node type repairs here as needed

        return NodeRepairResult(
            nodes=nodes,
            repairs_made=repairs,
            warnings=warnings,
        )

    @classmethod
    def _repair_if_else_operators(cls, node: dict[str, Any], repairs: list[str]):
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
