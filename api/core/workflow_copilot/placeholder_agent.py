"""The canned production placeholder ``CopilotAgent``.

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/placeholder_agent.go.

``PlaceholderAgent`` is the canned cognition for the Fix slice until the real
agent lands (a future spec). Its diagnosis/repair assume the common "Code
node raises at runtime" failure. It satisfies ``CopilotAgent`` structurally
(via ``@runtime_checkable``) — there is no explicit ``NewPlaceholderAgent()``
constructor to port; plain instantiation (``PlaceholderAgent()``) replaces it.
"""

from core.workflow_copilot.models import (
    ChecklistError,
    Diagnosis,
    Graph,
    Inputs,
    MutationIntent,
    NodeOutput,
    Risk,
    Run,
    StartSchema,
)

__all__ = ["FIXED_CODE", "PlaceholderAgent"]

# FIXED_CODE is the replacement body for the fixture's broken Code node — a
# minimal working program whose return shape matches what the fixture's End
# node reads. Keep it in sync with the Task-2 fixture.
FIXED_CODE = 'def main() -> dict:\n    return {"result": "ok"}'


class PlaceholderAgent:
    """Canned ``CopilotAgent`` cognition; see module docstring."""

    def diagnose(self, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> Diagnosis:
        culprit = "output"
        for o in node_outputs:
            if o.status in ("failed", "exception"):
                culprit = o.node_id
                break
        return Diagnosis(culprit_node_id=culprit, root_cause="Code node raised at runtime", severity="high")

    def diagnose_checklist(self, errors: list[ChecklistError], graph: Graph) -> Diagnosis:
        culprit, cause = "", "Checklist error"
        for e in errors:
            if e.messages:
                culprit, cause = e.node_id, e.messages[0]
                break
        return Diagnosis(culprit_node_id=culprit, root_cause=cause, severity="medium")

    def propose_repair(self, diagnosis: Diagnosis, graph: Graph) -> tuple[list[MutationIntent], Risk]:
        intents = [
            MutationIntent(
                op="set_node_config",
                args={"node_id": diagnosis.culprit_node_id, "path": "code", "value": FIXED_CODE},
            )
        ]
        return intents, Risk(level="low", reason="config-only fix", has_external_side_effect=False)

    def generate_mock_inputs(self, schema: StartSchema, prior_failed: Inputs) -> Inputs:
        return {"query": "mock"}
