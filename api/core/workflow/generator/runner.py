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
    format_builder_tool_catalogue_section,
    format_plan_block,
    get_builder_system_prompt,
)
from core.workflow.generator.prompts.planner_prompts import (
    PLANNER_SYSTEM_PROMPT,
    PLANNER_USER_PROMPT,
    format_ideal_output_section,
    format_tool_catalogue_section,
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
        tool_catalogue_text: str = "",
    ) -> WorkflowGenerateResultDict:
        """
        Run planner → builder → postprocess and return a graph payload.

        ``tool_catalogue_text`` is the formatted list of installed tools for
        the calling tenant (see ``tool_catalogue.build_tool_catalogue`` /
        ``format_tool_catalogue``). It's injected into both the planner and
        builder prompts so the LLM can pick concrete ``provider/tool``
        identifiers instead of inventing names; an empty string skips the
        section entirely (useful for unit tests).

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
                tool_catalogue_text=tool_catalogue_text,
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
                tool_catalogue_text=tool_catalogue_text,
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
        tool_catalogue_text: str,
    ) -> PlannerResultDict:
        user_prompt = PLANNER_USER_PROMPT.format(
            mode=mode,
            instruction=instruction.strip(),
            ideal_output_section=format_ideal_output_section(ideal_output),
            tool_catalogue_section=format_tool_catalogue_section(tool_catalogue_text),
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
        tool_catalogue_text: str,
    ) -> GraphDict:
        user_prompt = BUILDER_USER_PROMPT.format(
            instruction=instruction.strip(),
            ideal_output_section=format_ideal_output_section(ideal_output),
            provider=provider,
            name=model_name,
            mode_label=model_mode,
            plan_block=format_plan_block(plan_nodes),
            tool_catalogue_section=format_builder_tool_catalogue_section(tool_catalogue_text),
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

        # Container-child nodes carry their own relative positions inside the
        # parent and have a special ``type`` (custom-iteration-start /
        # custom-loop-start). We must not override their positions or wrapper
        # ``type``; only top-level (parentId-less) nodes get the left-to-right
        # auto layout.
        top_level_index = 0
        for node in nodes:
            cls._fill_node_defaults(node)
            if node.get("parentId"):
                # Inner node — keep whatever the LLM emitted; only fill the
                # absolutely-required defaults so the canvas can render it.
                node.setdefault("position", {"x": 0.0, "y": 0.0})
                node.setdefault("zIndex", 1002)
                node.setdefault("extent", "parent")
            else:
                node["position"] = {
                    "x": float(_NODE_X_OFFSET + _NODE_X_STEP * top_level_index),
                    "y": float(_NODE_Y),
                }
                top_level_index += 1
            node.setdefault("positionAbsolute", dict(node["position"]))
            node.setdefault("width", _DEFAULT_NODE_WIDTH)
            node.setdefault("height", _DEFAULT_NODE_HEIGHT)
            node.setdefault("sourcePosition", "right")
            node.setdefault("targetPosition", "left")

        # ``parentId`` → set of inner-node ids, so edges between siblings can be
        # marked ``isInIteration`` / ``isInLoop`` with the right container id.
        inner_node_to_parent: dict[str, str] = {
            n["id"]: n["parentId"] for n in nodes if n.get("parentId") and n.get("id")
        }
        # Map parent id → its container node-type so we can pick the right flag.
        parent_type: dict[str, str] = {}
        for n in nodes:
            if n.get("id") in inner_node_to_parent.values():
                parent_type[n["id"]] = n.get("data", {}).get("type", "")

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

            # An edge is "inside" a container iff both endpoints share the same
            # parent. Set isInIteration / isInLoop + iteration_id / loop_id +
            # zIndex so the canvas renders it inside the subgraph rather than
            # at the top level. Edges connecting a container to the outside
            # world keep the defaults (isInIteration=False, isInLoop=False).
            src_parent = inner_node_to_parent.get(edge.get("source", ""))
            tgt_parent = inner_node_to_parent.get(edge.get("target", ""))
            in_iter = bool(src_parent and src_parent == tgt_parent and parent_type.get(src_parent) == "iteration")
            in_loop = bool(src_parent and src_parent == tgt_parent and parent_type.get(src_parent) == "loop")
            edge["data"].setdefault("isInIteration", in_iter)
            edge["data"].setdefault("isInLoop", in_loop)
            if in_iter:
                edge["data"].setdefault("iteration_id", src_parent)
                edge.setdefault("zIndex", 1002)
            if in_loop:
                edge["data"].setdefault("loop_id", src_parent)
                edge.setdefault("zIndex", 1002)

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
