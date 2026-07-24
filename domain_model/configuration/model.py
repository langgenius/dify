"""Immutable runtime configuration captured from the existing Human Input v2 node DSL.

The workflow node model remains the source of truth for inputs, actions,
recipient specifications, messages, debug settings, and timeout semantics. This
context only freezes one validated node definition for exactly one runtime task.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Self, assert_never

from core.workflow.nodes.human_input.enums import TimeoutUnit
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData


@dataclass(frozen=True, slots=True)
class FormConfiguration:
    """Immutable configuration snapshot owned by one FormInstance.

    Lifecycle: captured once from a validated ``HumanInputNodeData`` when a
    runtime task is created, then retained unchanged for rendering, validation,
    timeout calculation, and historical explanation. ``revision`` and
    ``workflow_version`` record provenance; they do not imply an editable domain
    lifecycle. Current authorization never relies on this historical snapshot.
    """

    workflow_id: str
    workflow_version: str | None
    node_id: str
    revision: int
    captured_at: datetime
    _node_data_json: str = field(repr=False)

    @classmethod
    def capture(
        cls,
        *,
        workflow_id: str,
        workflow_version: str | None,
        node_id: str,
        revision: int,
        node_data: HumanInputNodeData,
        captured_at: datetime,
    ) -> Self:
        """Freeze one validated existing node definition for runtime use."""

        if not workflow_id or not node_id:
            raise ValueError("workflow_id and node_id must not be empty")
        if workflow_version == "":
            raise ValueError("workflow_version must be non-empty when provided")
        if revision <= 0:
            raise ValueError("configuration revision must be positive")
        if captured_at.tzinfo is None:
            raise ValueError("configuration capture timestamp must be timezone-aware")
        return cls(
            workflow_id=workflow_id,
            workflow_version=workflow_version,
            node_id=node_id,
            revision=revision,
            captured_at=captured_at,
            _node_data_json=node_data.model_dump_json(),
        )

    def materialize_node_data(self) -> HumanInputNodeData:
        """Return an independent instance of the existing v2 node model."""

        return HumanInputNodeData.model_validate_json(self._node_data_json)

    def expiration_time(self, started_at: datetime) -> datetime:
        """Calculate the task deadline from the captured timeout configuration."""

        node_data = self.materialize_node_data()
        match node_data.timeout_unit:
            case TimeoutUnit.HOUR:
                return started_at + timedelta(hours=node_data.timeout)
            case TimeoutUnit.DAY:
                return started_at + timedelta(days=node_data.timeout)
            case _:
                assert_never(node_data.timeout_unit)

    def has_action(self, action_id: str) -> bool:
        """Check whether an action belongs to the captured node definition."""

        return any(action.id == action_id for action in self.materialize_node_data().user_actions)
