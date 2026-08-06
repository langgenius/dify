"""Private unified-tracing state retained across workflow pauses.

Deferred from unified tracing v1: no v1 ``AppGenerateEntity`` carries this
state (see ADR-0001 "Out of scope (v1)"). Retained for re-adoption when
human-wait pause/resume tracing is reintroduced.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from core.ops.unified_trace.agent_events import AgentRunTraceFragment
from core.ops.unified_trace.human_wait import HumanWaitRecord


class WorkflowTraceState(BaseModel):
    collection_enabled: bool = False
    agent_fragments: list[AgentRunTraceFragment] = Field(default_factory=list)
    agent_fragment_parent_ids: dict[str, str] = Field(default_factory=dict)
    human_waits: list[HumanWaitRecord] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    def record_agent_fragments(self, parent_node_execution_id: str, fragments: list[object]) -> None:
        retained_by_run_id = {fragment.run_id: fragment for fragment in self.agent_fragments}
        for raw_fragment in fragments:
            try:
                fragment = AgentRunTraceFragment.model_validate(raw_fragment)
            except ValidationError:
                continue
            retained_by_run_id[fragment.run_id] = fragment
            self.agent_fragment_parent_ids[fragment.run_id] = parent_node_execution_id
        self.agent_fragments = list(retained_by_run_id.values())

    def agent_fragments_by_parent(self) -> dict[str, list[dict[str, object]]]:
        grouped: dict[str, list[dict[str, object]]] = {}
        for fragment in self.agent_fragments:
            parent_id = self.agent_fragment_parent_ids.get(fragment.run_id)
            if parent_id is None:
                continue
            grouped.setdefault(parent_id, []).append(fragment.model_dump(mode="json"))
        return grouped
