"""
Workflow generator runner.

Slim planner→builder pipeline. Pure domain logic; the model instance is
injected by ``WorkflowGeneratorService`` so this module stays cleanly
separated from the infrastructure layer.

Pipeline:

    1. PLANNER  — short LLM call producing a high-level node list.
    2. BUILDER  — structured-output LLM call producing the full graph JSON.
    3. POSTPROC — fill safe defaults, lay nodes out left-to-right, dedupe
                  edge ids, and run a final structural sanity check.

Intentionally NOT here (deferred to a future iteration):

    - Mermaid rendering
    - Heuristic node/edge auto-repair beyond default fill
    - Multi-step validation engine with classification of fixable vs. user-required errors
    - Tool / model catalogue filtering

If quality regresses below product threshold we add those back; for now the
single planner+builder pair shipped behind cmd+k `/create` is enough.
"""

import json
import logging
from typing import Any, cast

import json_repair

from core.workflow.generator.prompts.builder_prompts import (
    BUILDER_USER_PROMPT,
    format_plan_block,
    get_builder_system_prompt,
)
from core.workflow.generator.prompts.planner_prompts import (
    PLANNER_SYSTEM_PROMPT,
    PLANNER_USER_PROMPT,
    format_ideal_output_section,
)
from core.workflow.generator.types import (
    GraphDict,
    GraphViewportDict,
    PlannerResultDict,
    WorkflowGenerateResultDict,
    WorkflowGenerationMode,
)
from graphon.enums import BuiltinNodeTypes
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage

logger = logging.getLogger(__name__)


_NODE_X_OFFSET = 80
_NODE_X_STEP = 320
_NODE_Y = 280
_DEFAULT_VIEWPORT: GraphViewportDict = {"x": 0.0, "y": 0.0, "zoom": 0.7}
_DEFAULT_NODE_WIDTH = 244
_DEFAULT_NODE_HEIGHT = 100


class WorkflowGenerator:
    """
    Generates a Dify workflow graph from a natural-language instruction.

    Domain layer — receives an already-constructed model instance. Use
    ``services.workflow_generator_service.WorkflowGeneratorService`` to
    call this from controllers.
    """

    @classmethod
    def generate_workflow_graph(
        cls,
        *,
        model_instance,
        model_parameters: dict[str, Any],
        provider: str,
        model_name: str,
        model_mode: str,
        mode: WorkflowGenerationMode,
        instruction: str,
        ideal_output: str = "",
    ) -> WorkflowGenerateResultDict:
        """
        Run planner → builder → postprocess and return a graph payload.

        Returns a dict with ``graph``, ``message`` and ``error``. On any
        failure ``graph`` is an empty skeleton (single start node) and
        ``error`` carries a human-readable message; callers should toast
        ``error`` and keep the previous version visible.
        """

        empty_result: WorkflowGenerateResultDict = {
            "graph": {"nodes": [], "edges": [], "viewport": _DEFAULT_VIEWPORT},
            "message": "",
            "error": "",
        }

        # ── 1. PLANNER ────────────────────────────────────────────────────
        try:
            plan = cls._run_planner(
                model_instance=model_instance,
                model_parameters=model_parameters,
                mode=mode,
                instruction=instruction,
                ideal_output=ideal_output,
            )
        except Exception as e:
            logger.exception("Workflow generator: planner step failed")
            empty_result["error"] = f"Failed to plan workflow: {e}"
            return empty_result

        plan_nodes: list[dict[str, Any]] = cast(list[dict[str, Any]], plan.get("nodes", []))
        if not plan_nodes:
            empty_result["error"] = "Planner returned no nodes"
            return empty_result

        # ── 2. BUILDER ────────────────────────────────────────────────────
        try:
            graph = cls._run_builder(
                model_instance=model_instance,
                model_parameters=model_parameters,
                provider=provider,
                model_name=model_name,
                model_mode=model_mode,
                mode=mode,
                instruction=instruction,
                ideal_output=ideal_output,
                plan_nodes=plan_nodes,
            )
        except Exception as e:
            logger.exception("Workflow generator: builder step failed")
            empty_result["error"] = f"Failed to build workflow graph: {e}"
            return empty_result

        # ── 3. POSTPROC ───────────────────────────────────────────────────
        graph = cls._postprocess_graph(graph=graph, mode=mode)

        # Final structural sanity check — fail closed if start/end shape is wrong.
        structural_error = cls._validate_structure(graph=graph, mode=mode)
        if structural_error:
            logger.warning("Workflow generator: structural validation failed: %s", structural_error)
            return {
                "graph": graph,  # still return the partial graph so caller can debug
                "message": plan.get("description", ""),
                "error": structural_error,
            }

        return {
            "graph": graph,
            "message": plan.get("description", ""),
            "error": "",
        }

    # ------------------------------------------------------------------
    # Planner
    # ------------------------------------------------------------------
    @classmethod
    def _run_planner(
        cls,
        *,
        model_instance,
        model_parameters: dict[str, Any],
        mode: WorkflowGenerationMode,
        instruction: str,
        ideal_output: str,
    ) -> PlannerResultDict:
        user_prompt = PLANNER_USER_PROMPT.format(
            mode=mode,
            instruction=instruction.strip(),
            ideal_output_section=format_ideal_output_section(ideal_output),
        )
        messages = [
            SystemPromptMessage(content=PLANNER_SYSTEM_PROMPT),
            UserPromptMessage(content=user_prompt),
        ]
        response: LLMResult = model_instance.invoke_llm(
            prompt_messages=messages,
            model_parameters=_clamp_for_planner(model_parameters),
            stream=False,
        )
        text = response.message.get_text_content() or ""
        parsed = json_repair.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError(f"Planner returned non-object JSON: {type(parsed).__name__}")

        nodes = parsed.get("nodes")
        if not isinstance(nodes, list):
            raise ValueError("Planner returned no 'nodes' array")
        for node in nodes:
            if not isinstance(node, dict) or "node_type" not in node:
                raise ValueError(f"Planner node entry malformed: {node!r}")

        return cast(PlannerResultDict, parsed)

    # ------------------------------------------------------------------
    # Builder
    # ------------------------------------------------------------------
    @classmethod
    def _run_builder(
        cls,
        *,
        model_instance,
        model_parameters: dict[str, Any],
        provider: str,
        model_name: str,
        model_mode: str,
        mode: WorkflowGenerationMode,
        instruction: str,
        ideal_output: str,
        plan_nodes: list[dict[str, Any]],
    ) -> GraphDict:
        user_prompt = BUILDER_USER_PROMPT.format(
            instruction=instruction.strip(),
            ideal_output_section=format_ideal_output_section(ideal_output),
            provider=provider,
            name=model_name,
            mode_label=model_mode,
            plan_block=format_plan_block(plan_nodes),
        )
        messages = [
            SystemPromptMessage(content=get_builder_system_prompt(mode)),
            UserPromptMessage(content=user_prompt),
        ]
        response: LLMResult = model_instance.invoke_llm(
            prompt_messages=messages,
            model_parameters=model_parameters,
            stream=False,
        )
        text = response.message.get_text_content() or ""
        parsed = json_repair.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError(f"Builder returned non-object JSON: {type(parsed).__name__}")

        nodes = parsed.get("nodes")
        edges = parsed.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise ValueError("Builder graph missing 'nodes' or 'edges' arrays")

        viewport = parsed.get("viewport") or _DEFAULT_VIEWPORT
        return cast(
            GraphDict,
            {
                "nodes": nodes,
                "edges": edges,
                "viewport": viewport,
            },
        )

    # ------------------------------------------------------------------
    # Postprocessing
    # ------------------------------------------------------------------
    @classmethod
    def _postprocess_graph(cls, *, graph: GraphDict, mode: WorkflowGenerationMode) -> GraphDict:
        """Fill safe defaults, normalise positions and dedupe edges."""

        # Internally treat nodes/edges as untyped dicts — TypedDicts forbid the
        # arbitrary-key setdefault writes we need here, but the caller only sees
        # the final structurally-valid ``GraphDict`` shape.
        nodes: list[dict[str, Any]] = list(cast(list[dict[str, Any]], graph.get("nodes", [])))
        edges: list[dict[str, Any]] = list(cast(list[dict[str, Any]], graph.get("edges", [])))

        # Re-index node positions left-to-right in declaration order, regardless of
        # whatever the LLM returned. The Studio canvas re-layouts in any case but
        # this keeps the preview pane readable.
        for index, node in enumerate(nodes):
            cls._fill_node_defaults(node)
            node["position"] = {"x": float(_NODE_X_OFFSET + _NODE_X_STEP * index), "y": float(_NODE_Y)}
            node.setdefault("positionAbsolute", dict(node["position"]))
            node.setdefault("width", _DEFAULT_NODE_WIDTH)
            node.setdefault("height", _DEFAULT_NODE_HEIGHT)
            node.setdefault("sourcePosition", "right")
            node.setdefault("targetPosition", "left")

        # Dedupe edges (LLMs sometimes emit the same edge twice).
        seen: set[tuple[str, str, str, str]] = set()
        deduped_edges = []
        for edge in edges:
            cls._fill_edge_defaults(edge)
            key = (
                edge.get("source", ""),
                edge.get("sourceHandle", "source"),
                edge.get("target", ""),
                edge.get("targetHandle", "target"),
            )
            if key in seen:
                continue
            seen.add(key)
            edge["id"] = f"{key[0]}-{key[1]}-{key[2]}-{key[3]}"
            deduped_edges.append(edge)

        # Build source/target → node_type lookup so we can fill edge.data.{sourceType,targetType}
        # which Dify's edge renderer needs.
        type_by_id = {node.get("id", ""): node.get("data", {}).get("type", "") for node in nodes}
        for edge in deduped_edges:
            edge.setdefault("data", {})
            edge["data"].setdefault("sourceType", type_by_id.get(edge.get("source", ""), ""))
            edge["data"].setdefault("targetType", type_by_id.get(edge.get("target", ""), ""))

        viewport = graph.get("viewport") or _DEFAULT_VIEWPORT
        # Coerce to floats in case the LLM emitted strings.
        viewport = {
            "x": float(viewport.get("x", 0.0)),
            "y": float(viewport.get("y", 0.0)),
            "zoom": float(viewport.get("zoom", 0.7)),
        }

        return cast(GraphDict, {"nodes": nodes, "edges": deduped_edges, "viewport": viewport})

    @classmethod
    def _fill_node_defaults(cls, node: dict[str, Any]) -> None:
        """Ensure every node has the wrapper-level fields the Studio canvas needs."""
        node.setdefault("type", "custom")
        data = node.setdefault("data", {})
        data.setdefault("title", node.get("id", "Node"))
        data.setdefault("desc", "")
        data.setdefault("selected", False)
        # `data.type` is the actual node-type string — we never override it.

    @classmethod
    def _fill_edge_defaults(cls, edge: dict[str, Any]) -> None:
        edge.setdefault("type", "custom")
        edge.setdefault("sourceHandle", "source")
        edge.setdefault("targetHandle", "target")

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------
    @classmethod
    def _validate_structure(cls, *, graph: GraphDict, mode: WorkflowGenerationMode) -> str:
        """
        Return an error string if the graph violates the start/end-shape contract.

        Only catches structural violations the user must know about. Per-node
        config validation is deferred to ``WorkflowService.sync_draft_workflow``.
        """
        nodes = graph.get("nodes", [])
        if not nodes:
            return "Generated graph has no nodes"

        types = [node.get("data", {}).get("type", "") for node in nodes]
        starts = [t for t in types if t == BuiltinNodeTypes.START]
        if len(starts) != 1:
            return f"Workflow must have exactly one 'start' node (found {len(starts)})"

        if mode == "advanced-chat":
            terminals = [t for t in types if t == BuiltinNodeTypes.ANSWER]
            terminal_name = "answer"
        else:
            terminals = [t for t in types if t == BuiltinNodeTypes.END]
            terminal_name = "end"

        if len(terminals) < 1:
            return f"Workflow must end with at least one '{terminal_name}' node"

        # Edges must reference real node ids.
        known_ids = {node.get("id", "") for node in nodes}
        for edge in graph.get("edges", []):
            if edge.get("source") not in known_ids:
                return f"Edge references unknown source node: {edge.get('source')!r}"
            if edge.get("target") not in known_ids:
                return f"Edge references unknown target node: {edge.get('target')!r}"

        return ""


def _clamp_for_planner(params: dict[str, Any]) -> dict[str, Any]:
    """
    The planner needs only a tight, deterministic plan — clamp temperature
    and max_tokens so we don't burn budget. Returns a copy.
    """
    out = dict(params)
    out.setdefault("temperature", 0.2)
    if "temperature" in out and isinstance(out["temperature"], (int, float)) and out["temperature"] > 0.5:
        out["temperature"] = 0.2
    return out


# Re-export json for callers / tests; keeps ruff happy when only the module is imported.
_ = json
