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
import re
from typing import Any, ClassVar, cast

import json_repair

from core.workflow.generator.prompts.builder_prompts import (
    BUILDER_USER_PROMPT,
    format_builder_tool_catalogue_section,
    format_plan_block,
    format_start_inputs_section,
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
            "app_name": "",
            "icon": "",
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

        # Planner-supplied user-input declarations. The builder uses these to
        # populate ``start.data.variables`` so downstream ``{#start.<var>#}``
        # references resolve at run time. Optional field — older prompts may
        # omit it, in which case the postprocess walker auto-fixes references.
        start_inputs_raw = plan.get("start_inputs") or []
        start_inputs: list[dict[str, Any]] = [
            cast(dict[str, Any], item)
            for item in start_inputs_raw
            if isinstance(item, dict) and (item.get("variable") or "").strip()
        ]

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
                start_inputs=start_inputs,
            )
        except Exception as e:
            logger.exception("Workflow generator: builder step failed")
            empty_result["error"] = f"Failed to build workflow graph: {e}"
            return empty_result

        # ── 3. POSTPROC ───────────────────────────────────────────────────
        graph = cls._postprocess_graph(graph=graph, mode=mode)

        # Surface the planner-supplied display metadata to the frontend so
        # ``applyToNewApp`` can name the new app and pick a meaningful icon
        # instead of the canned ``deriveAppName`` + 🤖 fallback. Both fields
        # default to "" when the LLM omits them — the FE owns the fallback.
        app_name = str(plan.get("app_name") or "").strip()
        icon = str(plan.get("icon") or "").strip()

        # Final structural sanity check — fail closed if start/end shape is wrong.
        structural_error = cls._validate_structure(graph=graph, mode=mode)
        if structural_error:
            logger.warning("Workflow generator: structural validation failed: %s", structural_error)
            return {
                "graph": graph,  # still return the partial graph so caller can debug
                "message": plan.get("description", ""),
                "app_name": app_name,
                "icon": icon,
                "error": structural_error,
            }

        return {
            "graph": graph,
            "message": plan.get("description", ""),
            "app_name": app_name,
            "icon": icon,
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
        start_inputs: list[dict[str, Any]] | None = None,
    ) -> GraphDict:
        user_prompt = BUILDER_USER_PROMPT.format(
            instruction=instruction.strip(),
            ideal_output_section=format_ideal_output_section(ideal_output),
            provider=provider,
            name=model_name,
            mode_label=model_mode,
            plan_block=format_plan_block(plan_nodes),
            tool_catalogue_section=format_builder_tool_catalogue_section(tool_catalogue_text),
            start_inputs_section=format_start_inputs_section(start_inputs or []),
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

        # Variable-reference walker: every ``{#node-id.var#}`` and every
        # ``["node-id", "var"]`` selector must point at a variable the source
        # node actually exposes — otherwise the workflow's variable resolver
        # fails at run time with "variable not found". The dominant failure
        # mode is a prompt that references ``{#start.url#}`` when the start
        # node has ``variables: []``, so we auto-inject missing start-node
        # variables before we surface them as errors.
        cls._reconcile_variable_references(nodes=nodes, mode=mode)

        return cast(GraphDict, {"nodes": nodes, "edges": deduped_edges, "viewport": viewport})

    # ------------------------------------------------------------------
    # Variable-reference reconciliation
    # ------------------------------------------------------------------

    # Detects ``{#node-id.var#}`` placeholders inside strings — the same
    # syntax the workflow runtime uses for prompt interpolation.
    _VAR_REF_RE: ClassVar = re.compile(r"\{#([^.#]+)\.([^#]+)#\}")

    @classmethod
    def _reconcile_variable_references(
        cls, *, nodes: list[dict[str, Any]], mode: WorkflowGenerationMode
    ) -> None:
        """
        Walk every variable reference, ensure it resolves; auto-fix missing
        start-node variables (the safe, dominant case) by adding a stub
        ``paragraph`` entry to ``start.data.variables``.

        For Advanced-Chat mode, ``sys.query`` and ``sys.files`` are always
        treated as resolved without any declaration. Tool nodes' parameter
        references aren't validated here because we don't know each tool's
        schema — the run time validates those.
        """
        nodes_by_id: dict[str, dict[str, Any]] = {
            n.get("id", ""): n for n in nodes if n.get("id")
        }
        start_node = next(
            (n for n in nodes if n.get("data", {}).get("type") == BuiltinNodeTypes.START),
            None,
        )

        # Collect every (node_id, var) reference the builder emitted.
        refs: set[tuple[str, str]] = set()
        for node in nodes:
            cls._collect_refs_in_data(node.get("data") or {}, refs)

        for node_id, var in refs:
            # Advanced-Chat system variables are always resolved.
            if mode == "advanced-chat" and node_id == "sys":
                continue
            target = nodes_by_id.get(node_id)
            if target is None:
                # An edge / data dangling reference — we can't fix it; the
                # structural validator picks this up if it's a topology issue.
                continue
            if cls._declares_variable(target, var):
                continue
            # Missing variable. Auto-fix start-node references; let everything
            # else fall through and surface in the result's ``error`` field
            # via the post-postprocess validator below.
            if start_node is not None and target is start_node:
                cls._inject_start_variable(start_node, var)
                logger.info("Workflow generator: auto-injected missing start variable %r", var)

    @classmethod
    def _collect_refs_in_data(cls, value: Any, out: set[tuple[str, str]]) -> None:
        """Recursively walk a node's ``data`` and harvest every reference."""
        if isinstance(value, str):
            for match in cls._VAR_REF_RE.finditer(value):
                node_id, var = match.group(1).strip(), match.group(2).strip()
                if node_id and var:
                    out.add((node_id, var))
            return
        if isinstance(value, dict):
            # Known selector shapes: 2-element [node_id, var] lists.
            for k, v in value.items():
                # ``value_selector`` / ``query_variable_selector`` / etc.: a
                # flat 2-element list of strings.
                if (
                    isinstance(v, list)
                    and len(v) == 2
                    and all(isinstance(x, str) for x in v)
                    and k != "default"  # default values for input variables are not selectors
                ):
                    node_id, var = v[0].strip(), v[1].strip()
                    if node_id and var:
                        out.add((node_id, var))
                cls._collect_refs_in_data(v, out)
            return
        if isinstance(value, list):
            for item in value:
                cls._collect_refs_in_data(item, out)

    @classmethod
    def _declares_variable(cls, node: dict[str, Any], var: str) -> bool:
        """
        Does ``node`` expose a variable named ``var``? Each node type
        publishes outputs differently — start exposes ``data.variables``,
        llm exposes ``text``, code exposes ``data.outputs`` keys, etc.
        Tool parameters are validated at run time, not here.
        """
        data = node.get("data") or {}
        node_type = data.get("type")
        if node_type == BuiltinNodeTypes.START:
            return any(
                isinstance(v, dict) and v.get("variable") == var
                for v in (data.get("variables") or [])
            )
        if node_type == BuiltinNodeTypes.LLM:
            # Default LLM output is ``text``. Structured-output keys land
            # under ``structured_output.schema.properties`` when enabled.
            if var == "text":
                return True
            schema = ((data.get("structured_output") or {}).get("schema") or {}).get("properties") or {}
            return var in schema
        if node_type == BuiltinNodeTypes.CODE:
            return var in (data.get("outputs") or {})
        if node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
            return var == "result"
        if node_type == BuiltinNodeTypes.PARAMETER_EXTRACTOR:
            return any(
                isinstance(p, dict) and p.get("name") == var
                for p in (data.get("parameters") or [])
            )
        if node_type == BuiltinNodeTypes.HTTP_REQUEST:
            return var in {"body", "status_code", "headers", "files"}
        if node_type == BuiltinNodeTypes.TEMPLATE_TRANSFORM:
            return var == "output"
        if node_type == BuiltinNodeTypes.TOOL:
            # Tool outputs are dynamic — validated at run time, not here.
            return True
        if node_type in (BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP):
            return var == "output"
        if node_type == BuiltinNodeTypes.QUESTION_CLASSIFIER:
            return var in {"class_id", "class_name"}
        # Other node types (if-else, iteration-start, loop-start, ...) don't
        # produce outputs of their own.
        return False

    @classmethod
    def _inject_start_variable(cls, start_node: dict[str, Any], var: str) -> None:
        """Add a default ``paragraph`` input so ``{#start.<var>#}`` resolves."""
        data = start_node.setdefault("data", {})
        existing = data.setdefault("variables", [])
        if any(isinstance(v, dict) and v.get("variable") == var for v in existing):
            return
        existing.append(
            {
                "variable": var,
                "label": _label_from_variable(var),
                "type": "paragraph",
                "required": True,
                "max_length": 4096,
                "options": [],
            }
        )

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


def _label_from_variable(var: str) -> str:
    """Turn ``snake_case`` / ``camelCase`` into a Title-Cased UI label."""
    if not var:
        return ""
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", var).lower()
    return " ".join(part.capitalize() for part in snake.split("_") if part)


# Re-export json for callers / tests; keeps ruff happy when only the module is imported.
_ = json
