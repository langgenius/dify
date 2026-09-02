"""The canned production placeholder ``DifyBuilderAgent``.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/placeholder_agent.go.

``PlaceholderAgent`` is the canned cognition for the Fix slice until the real
agent lands (a future spec). Its diagnosis/repair assume the common "Code
node raises at runtime" failure. It satisfies ``DifyBuilderAgent`` structurally
(via ``@runtime_checkable``) — there is no explicit ``NewPlaceholderAgent()``
constructor to port; plain instantiation (``PlaceholderAgent()``) replaces it.
"""

from collections.abc import Callable
from typing import Any

from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import (
    ChecklistError,
    ConversationItem,
    Diagnosis,
    DifyBuilderContext,
    Graph,
    Inputs,
    MutationIntent,
    NodeOutput,
    Risk,
    Run,
    StartSchema,
)
from core.dify_builder.state import PcState
from graphon.enums import BuiltinNodeTypes
from services.dify_builder import node_defaults

__all__ = [
    "BUILD_END_ID",
    "BUILD_KNOWLEDGE_ID",
    "BUILD_LLM_ID",
    "BUILD_START_ID",
    "FIXED_CODE",
    "PlaceholderAgent",
]

FIXED_CODE = 'def main() -> dict:\n    return {"result": "ok"}'

# Deterministic node ids for the canned Build graph, so connect intents can
# reference them and built_node_ids is known up front.
BUILD_START_ID = "start"
BUILD_KNOWLEDGE_ID = "knowledge_retrieval"
BUILD_LLM_ID = "llm"
BUILD_END_ID = "end"


class PlaceholderAgent:
    """Canned ``DifyBuilderAgent`` cognition; see module docstring."""

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

    # -- Build cognition (Slice 2; fixed, deterministic canned output) --

    def analyze_goal(self, goal_text: str) -> dict[str, Any]:
        # Always proceeds -- no real missing-info branch. The challenge card
        # the handler shows is an informational "proceeding" note.
        return {
            "fields": [
                {"key": "report_types", "label": "Report types", "type": "text"},
                {"key": "audience", "label": "Audience", "type": "text"},
                {"key": "currency", "label": "Currency", "type": "text"},
                {"key": "metrics", "label": "Metrics", "type": "text"},
                {"key": "output", "label": "Output", "type": "textarea"},
                {"key": "prefer_audited", "label": "Prefer audited sources", "type": "bool"},
            ],
            "values": {
                "report_types": "quarterly",
                "audience": "executives",
                "currency": "USD",
                "metrics": "revenue, gross_margin",
                "output": "PDF summary",
                "prefer_audited": True,
            },
        }

    def propose_plan_v1(self, requirements: dict[str, Any]) -> list[str]:
        return [
            "Ingest source documents",
            "Retrieve relevant knowledge",
            "Summarize with an LLM",
            "Emit the final report",
        ]

    def discover_resources(self, plan_items: list[str]) -> list[ResourceOption]:
        return [
            ResourceOption(
                id="kb-company",
                label="Company Knowledge Base",
                meta="1,024 documents",
                kind="knowledge",
                readiness="ready",
            )
        ]

    def bind_resources(self, plan_items: list[str], resource_ids: list[str], conflict_policy: str) -> list[str]:
        return [
            "Ingest source documents",
            "Retrieve from Company Knowledge Base",
            "Summarize with the configured LLM",
            "Emit the final report",
        ]

    def build_nodes(self, plan_items: list[str]) -> list[MutationIntent]:
        # Start -> Knowledge-Retrieval -> LLM -> End. Creates and connects are
        # interleaved so each connect's endpoints already exist when
        # apply_connect validates them.
        return [
            MutationIntent(
                op="create_node",
                args={
                    "node_type": BuiltinNodeTypes.START,
                    "config": node_defaults.default_config(BuiltinNodeTypes.START),
                    "node_id": BUILD_START_ID,
                },
            ),
            MutationIntent(
                op="create_node",
                args={
                    "node_type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                    "config": node_defaults.default_config(BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL),
                    "node_id": BUILD_KNOWLEDGE_ID,
                },
            ),
            MutationIntent(op="connect", args={"from_node": BUILD_START_ID, "to_node": BUILD_KNOWLEDGE_ID}),
            MutationIntent(
                op="create_node",
                args={
                    "node_type": BuiltinNodeTypes.LLM,
                    "config": node_defaults.default_config(BuiltinNodeTypes.LLM),
                    "node_id": BUILD_LLM_ID,
                },
            ),
            MutationIntent(op="connect", args={"from_node": BUILD_KNOWLEDGE_ID, "to_node": BUILD_LLM_ID}),
            MutationIntent(
                op="create_node",
                args={
                    "node_type": BuiltinNodeTypes.END,
                    "config": node_defaults.default_config(BuiltinNodeTypes.END),
                    "node_id": BUILD_END_ID,
                },
            ),
            MutationIntent(op="connect", args={"from_node": BUILD_LLM_ID, "to_node": BUILD_END_ID}),
        ]

    def learn_from_build(
        self,
        goal_text: str,
        requirements: dict[str, Any],
        plan_items: list[str],
        built_node_ids: list[str],
    ) -> str:
        return "Reusable skill: a Start->Knowledge->LLM->End summary workflow"

    # -- Edit cognition (Slice 3; fixed, deterministic canned output) --

    def analyze_impact(self, goal_text: str, graph: Graph) -> dict[str, Any]:
        # Pick affected nodes from the existing graph (LLM + knowledge), with a
        # canned-id fallback so the flow works on any Build-shaped draft.
        node_ids = {n.get("id") for n in graph.get("nodes", [])}
        targets = [nid for nid in (BUILD_LLM_ID, BUILD_KNOWLEDGE_ID) if nid in node_ids] or [BUILD_LLM_ID]
        return {
            "fields": [
                {"key": "risk_threshold", "label": "Risk threshold", "type": "text"},
                {
                    "key": "review_team",
                    "label": "Review team",
                    "type": "select",
                    "options": ["compliance", "legal", "engineering"],
                },
                {
                    "key": "timeout_behavior",
                    "label": "Timeout behavior",
                    "type": "select",
                    "options": ["fail_open", "fail_closed"],
                },
                {"key": "preserve_summary", "label": "Preserve summary", "type": "bool"},
            ],
            "values": {
                "risk_threshold": "medium",
                "review_team": "compliance",
                "timeout_behavior": "fail_closed",
                "preserve_summary": True,
            },
            "target_node_ids": targets,
        }

    def propose_edit_plan(self, edit_rules: dict[str, Any], graph: Graph) -> list[str]:
        return [
            "Tighten the LLM risk threshold",
            "Route high-risk output to the review team",
            "Apply the timeout behavior",
            "Preserve the existing summary contract",
        ]

    def build_edit_intents(self, edit_rules: dict[str, Any], graph: Graph) -> list[MutationIntent]:
        # Canned config-level edits (set_node_config) on the existing LLM node,
        # matching the edit_rules semantics. Deterministic target selection:
        # prefer the canned LLM id, else the lexicographically-first node id.
        node_ids = {n.get("id") for n in graph.get("nodes", []) if n.get("id")}
        if BUILD_LLM_ID in node_ids:
            llm_id = BUILD_LLM_ID
        elif node_ids:
            llm_id = min(node_ids)
        else:
            llm_id = BUILD_LLM_ID
        return [
            MutationIntent(
                op="set_node_config",
                args={
                    "node_id": llm_id,
                    "path": "risk_threshold",
                    "value": edit_rules.get("risk_threshold", "medium"),
                },
            ),
            MutationIntent(
                op="set_node_config",
                args={
                    "node_id": llm_id,
                    "path": "timeout_behavior",
                    "value": edit_rules.get("timeout_behavior", "fail_closed"),
                },
            ),
        ]

    def respond_to_message(
        self,
        state: PcState,
        context: DifyBuilderContext,
        history: list[ConversationItem],
        graph: Graph,
        text: str,
        on_delta: Callable[[str], None] | None = None,
    ) -> str:
        """Deterministic fallback used when Builder LLM mode is disabled."""
        del context, history, graph
        reply = (
            f'I understand your note: "{text}". The Builder is currently at {state}. '
            "I have not changed the workflow; use one of the available actions when you want to continue."
        )
        if on_delta is not None:
            on_delta(reply)
        return reply
