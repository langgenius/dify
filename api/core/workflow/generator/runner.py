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
import time
from typing import Any, ClassVar, cast

import json_repair

from core.workflow.generator.prompts.builder_prompts import (
    BUILDER_USER_PROMPT,
    format_builder_existing_graph_section,
    format_builder_tool_catalogue_section,
    format_plan_block,
    format_start_inputs_section,
    get_builder_system_prompt,
)
from core.workflow.generator.prompts.planner_prompts import (
    PLANNER_SYSTEM_PROMPT,
    PLANNER_USER_PROMPT,
    format_existing_graph_section,
    format_ideal_output_section,
    format_tool_catalogue_section,
)
from core.workflow.generator.types import (
    GraphDict,
    GraphViewportDict,
    PlannerResultDict,
    WorkflowGenerateErrorCode,
    WorkflowGenerateErrorDict,
    WorkflowGenerateResultDict,
    WorkflowGenerationMode,
)
from graphon.enums import BuiltinNodeTypes
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from graphon.model_runtime.errors.invoke import (
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

logger = logging.getLogger(__name__)


_NODE_X_OFFSET = 80
_NODE_X_STEP = 320
_NODE_Y = 280
# Vertical gap between lanes when two branches share the same topological
# depth (e.g. the two arms of an if-else). Default node height is 100, so
# 160 leaves clear air between stacked nodes.
_NODE_Y_STEP = 160
_DEFAULT_VIEWPORT: GraphViewportDict = {"x": 0.0, "y": 0.0, "zoom": 0.7}
_DEFAULT_NODE_WIDTH = 244
_DEFAULT_NODE_HEIGHT = 100

# Start-node input variable types that carry file uploads. Mirrors
# ``graphon.variables.input_entities.VariableEntityType.FILE / FILE_LIST``.
_FILE_VARIABLE_TYPES = frozenset({"file", "file-list"})

# Backstop defaults for a file / file-list start variable when the builder
# omits the required upload config. ``allowed_file_types`` is a REQUIRED field
# (Studio rejects the draft with "supported file types is required" when it's
# empty — see ``config-var/config-modal/utils.ts``); we default to every
# standard type so no valid upload is rejected. ``custom`` is intentionally
# excluded because it would in turn require a non-empty
# ``allowed_file_extensions``. The real fix is the builder now documenting and
# emitting these fields; this is the safety net that guarantees a loadable draft.
_DEFAULT_ALLOWED_FILE_TYPES = ("document", "image", "audio", "video")
_DEFAULT_FILE_UPLOAD_METHODS = ("local_file", "remote_url")

# Token ceiling for the planner call when the caller didn't pin one. The plan
# is a short JSON node list (a handful of nodes with labels/purposes), so this
# is generous headroom while still bounding a runaway response. The builder is
# left on the caller's budget — it emits the full graph and genuinely needs it.
_PLANNER_DEFAULT_MAX_TOKENS = 4096


# Appended as a trailing user message on the SECOND (and only) attempt when
# the first response wasn't parseable as JSON. Keep this terse — the model
# already has its full instructions in the original system message; this is
# a corrective nudge, not a re-statement of the spec.
_JSON_RETRY_HINT = (
    "Your previous response was not valid JSON. Return ONLY a single JSON object. "
    "Do not include any prose, markdown code fences, comments, or trailing commas."
)


# Provider hiccups we retry: a dropped connection, a 5xx, or a rate-limit are
# all transient — the same request usually succeeds moments later. We do NOT
# retry InvokeAuthorizationError / InvokeBadRequestError: those are permanent
# misconfigurations where a retry only adds latency and burns quota.
_TRANSIENT_INVOKE_ERRORS = (
    InvokeConnectionError,
    InvokeServerUnavailableError,
    InvokeRateLimitError,
)

# Total invoke attempts per LLM call (1 original + retries) before we give up
# and let the error surface as the stage's MODEL_ERROR envelope.
_INVOKE_MAX_ATTEMPTS = 3

# Backoff before each retry, indexed by retry number (the wait before attempt
# 2, then before attempt 3). Short and bounded — generation is a foreground
# request, so we trade a couple of seconds for resilience, not minutes.
_INVOKE_BACKOFF_SECONDS = (0.5, 1.5)


class _StageJSONError(ValueError):
    """Raised when ``json_repair`` cannot parse a stage's response.

    ``stage`` is the human-readable stage name ("Planner" / "Builder") so
    the outer error envelope's ``detail`` can name which step blew up.
    """

    def __init__(self, stage: str, detail: str) -> None:
        super().__init__(f"{stage} JSON invalid: {detail}")
        self.stage = stage


class _StageSchemaError(ValueError):
    """Raised when a stage's parsed JSON violates the expected schema."""

    def __init__(self, stage: str, detail: str) -> None:
        super().__init__(f"{stage} schema invalid: {detail}")
        self.stage = stage


def _err(code: str, detail: str, node_id: str = "") -> WorkflowGenerateErrorDict:
    """Build a structured error dict; ``node_id`` is included only when set."""
    out: WorkflowGenerateErrorDict = {"code": code, "detail": detail}
    if node_id:
        out["node_id"] = node_id
    return out


def _errors_to_str(errors: list[WorkflowGenerateErrorDict]) -> str:
    """Concatenate structured errors into the legacy single-string envelope."""
    return "; ".join(e["detail"] for e in errors)


def _empty_result() -> WorkflowGenerateResultDict:
    """Fresh skeleton with no graph and no metadata — used for early returns."""
    return {
        "graph": {"nodes": [], "edges": [], "viewport": _DEFAULT_VIEWPORT},
        "message": "",
        "app_name": "",
        "icon": "",
        "error": "",
        "errors": [],
    }


def _result_with_errors(
    base: WorkflowGenerateResultDict,
    errors: list[WorkflowGenerateErrorDict],
) -> WorkflowGenerateResultDict:
    """Attach a structured error list to ``base``, populating the legacy ``error`` string too."""
    base["errors"] = errors
    base["error"] = _errors_to_str(errors)
    return base


def _stage_error_to_envelope_code(exc: Exception) -> str:
    """Map a stage-typed exception to the result envelope's error code."""
    if isinstance(exc, _StageJSONError):
        return WorkflowGenerateErrorCode.INVALID_JSON
    if isinstance(exc, _StageSchemaError):
        return WorkflowGenerateErrorCode.INVALID_SCHEMA
    return WorkflowGenerateErrorCode.MODEL_ERROR


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
        installed_tools: set[tuple[str, str]] | None = None,
        current_graph: dict[str, Any] | None = None,
    ) -> WorkflowGenerateResultDict:
        """
        Run planner → builder → postprocess and return a graph payload.

        ``current_graph`` switches the pipeline from create mode to REFINE
        mode: the existing draft graph is injected into both the planner
        (compact node/edge summary) and the builder (full JSON) so the LLM
        amends the graph the user is editing instead of inventing a new one.
        ``None`` (the default) is plain create-from-scratch behaviour.

        ``tool_catalogue_text`` is the formatted list of installed tools for
        the calling tenant (see ``tool_catalogue.build_tool_catalogue`` /
        ``format_tool_catalogue``). It's injected into both the planner and
        builder prompts so the LLM can pick concrete ``provider/tool``
        identifiers instead of inventing names; an empty string skips the
        section entirely (useful for unit tests).

        ``installed_tools`` is the structural sibling — a set of
        ``(provider_name, tool_name)`` pairs the validator consults to reject
        tool nodes the planner / builder may have hallucinated. ``None``
        disables tool validation (used by unit tests and when the catalogue
        build itself failed; the service-layer fallback is already empty
        prompt text in that case).

        Returns a dict with ``graph``, ``message``, ``error`` and ``errors``.
        On any failure ``graph`` is an empty skeleton (single start node),
        ``error`` is the concatenated human-readable diagnostic, and
        ``errors`` carries machine-readable codes the frontend maps to
        localised copy. Callers should toast the first localised entry from
        ``errors`` and keep the previous version visible.
        """

        # ── 1. PLANNER ────────────────────────────────────────────────────
        plan, plan_err = cls._run_stage(
            stage="Planner",
            failure_fallback_message="Failed to plan workflow",
            run=lambda: cls._run_planner(
                model_instance=model_instance,
                model_parameters=model_parameters,
                mode=mode,
                instruction=instruction,
                ideal_output=ideal_output,
                tool_catalogue_text=tool_catalogue_text,
                current_graph=current_graph,
            ),
        )
        if plan_err is not None:
            return _result_with_errors(_empty_result(), [plan_err])

        # The lambda return is non-None when no error fired — narrow it for type-checkers.
        plan = cast(PlannerResultDict, plan)
        plan_nodes: list[dict[str, Any]] = cast(list[dict[str, Any]], plan.get("nodes", []))
        if not plan_nodes:
            return _result_with_errors(
                _empty_result(),
                [_err(WorkflowGenerateErrorCode.EMPTY_PLAN, "Planner returned no nodes")],
            )

        # Planner-supplied user-input declarations. The builder uses these to
        # populate ``start.data.variables`` so downstream ``{#start.<var>#}``
        # references resolve at run time. Optional field — older prompts may
        # omit it, in which case the postprocess walker auto-fixes references.
        start_inputs: list[dict[str, Any]] = [
            cast(dict[str, Any], item)
            for item in (plan.get("start_inputs") or [])
            if isinstance(item, dict) and (item.get("variable") or "").strip()
        ]

        # ── 2. BUILDER ────────────────────────────────────────────────────
        graph, build_err = cls._run_stage(
            stage="Builder",
            failure_fallback_message="Failed to build workflow graph",
            run=lambda: cls._run_builder(
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
                current_graph=current_graph,
            ),
        )
        if build_err is not None:
            return _result_with_errors(_empty_result(), [build_err])
        graph = cast(GraphDict, graph)

        # ── 3. POSTPROC + VALIDATE ────────────────────────────────────────
        graph = cls._postprocess_graph(graph=graph, mode=mode)

        # ``app_name`` / ``icon`` are planner display metadata; both default
        # to "" when the LLM omits them — the FE owns the fallback.
        result: WorkflowGenerateResultDict = {
            "graph": graph,
            "message": plan.get("description", ""),
            "app_name": str(plan.get("app_name") or "").strip(),
            "icon": str(plan.get("icon") or "").strip(),
            "error": "",
            "errors": [],
        }

        # Final structural sanity check — fail closed if start/end shape is
        # wrong, container topology is broken, a tool was hallucinated, or a
        # variable reference points at a node that won't expose it. We still
        # return the partial graph so the caller can debug or salvage it.
        structural_errors = cls._validate_structure(graph=graph, mode=mode, installed_tools=installed_tools)
        if structural_errors:
            logger.warning("Workflow generator: structural validation failed: %s", structural_errors)
            return _result_with_errors(result, structural_errors)
        return result

    @classmethod
    def _run_stage(
        cls,
        *,
        stage: str,
        failure_fallback_message: str,
        run,
    ) -> tuple[Any, WorkflowGenerateErrorDict | None]:
        """
        Execute one pipeline stage and translate exceptions into a typed envelope entry.

        Returns ``(result, None)`` on success and ``(None, error)`` on failure.
        Stage-specific JSON / schema errors map to their dedicated codes; any
        other exception is logged with the stack trace and mapped to
        ``MODEL_ERROR`` (the LLM call itself blew up — provider auth, quota,
        network — caller usually wants this as a retry hint).
        """
        try:
            return run(), None
        except (_StageJSONError, _StageSchemaError) as e:
            logger.warning("Workflow generator: %s", e)
            return None, _err(_stage_error_to_envelope_code(e), str(e))
        except Exception as e:
            logger.exception("Workflow generator: %s step failed", stage.lower())
            return None, _err(WorkflowGenerateErrorCode.MODEL_ERROR, f"{failure_fallback_message}: {e}")

    # ------------------------------------------------------------------
    # Shared LLM call + JSON parse with one-shot retry
    # ------------------------------------------------------------------
    @classmethod
    def _invoke_with_retry(
        cls,
        *,
        model_instance,
        prompt_messages,
        model_parameters: dict[str, Any],
        stage: str,
    ) -> LLMResult:
        """
        Invoke the LLM, retrying transient provider errors with bounded backoff.

        A single dropped connection, 503, or rate-limit used to fail the whole
        two-call generation; one retry recovers the dominant transient case.
        Permanent errors (auth, bad-request) are NOT in
        ``_TRANSIENT_INVOKE_ERRORS`` so they propagate on the first attempt —
        retrying a misconfigured model only adds latency and burns quota.
        """
        last_exc: Exception | None = None
        for attempt in range(_INVOKE_MAX_ATTEMPTS):
            try:
                return model_instance.invoke_llm(
                    prompt_messages=prompt_messages,
                    model_parameters=model_parameters,
                    stream=False,
                )
            except _TRANSIENT_INVOKE_ERRORS as e:
                last_exc = e
                if attempt >= _INVOKE_MAX_ATTEMPTS - 1:
                    break
                delay = _INVOKE_BACKOFF_SECONDS[min(attempt, len(_INVOKE_BACKOFF_SECONDS) - 1)]
                logger.info(
                    "Workflow generator: %s transient invoke error (attempt %s/%s): %s; retrying in %ss",
                    stage,
                    attempt + 1,
                    _INVOKE_MAX_ATTEMPTS,
                    e,
                    delay,
                )
                time.sleep(delay)
        # Exhausted the retry budget — re-raise the last transient error so the
        # surrounding stage maps it to a MODEL_ERROR envelope.
        assert last_exc is not None
        raise last_exc

    @classmethod
    def _invoke_and_parse_json(
        cls,
        *,
        model_instance,
        messages,
        model_parameters: dict[str, Any],
        stage: str,
    ) -> dict[str, Any]:
        """
        Call the LLM and parse the response as JSON, retrying ONCE on parse failure.

        Why one retry only: each LLM call is expensive (full system+user
        prompt), so an open retry loop would burn quota for a model that's
        fundamentally returning prose instead of JSON. One retry with a
        corrective hint catches the dominant failure mode — a stray
        markdown fence or trailing prose — without masking a model that
        simply can't follow the spec.

        On the second failure ``_StageJSONError`` bubbles up so the outer
        runner can tag it ``INVALID_JSON`` in the result envelope.
        """
        last_detail = ""
        for attempt in range(2):
            # The corrective nudge goes in as a trailing USER message, not a
            # system one: a system message appended after the user turn is
            # silently dropped or reordered by several providers (Anthropic,
            # Gemini), so the retry hint would never reach the model. A user
            # turn is always the latest instruction the model answers.
            attempt_messages = messages if attempt == 0 else [*messages, UserPromptMessage(content=_JSON_RETRY_HINT)]
            response = cls._invoke_with_retry(
                model_instance=model_instance,
                prompt_messages=attempt_messages,
                model_parameters=model_parameters,
                stage=stage,
            )
            text = response.message.get_text_content() or ""
            try:
                parsed = json_repair.loads(text)
            except Exception as e:
                last_detail = str(e)
                logger.info("Workflow generator: %s JSON parse failed on attempt %s: %s", stage, attempt + 1, e)
                continue
            if isinstance(parsed, dict):
                if attempt > 0:
                    logger.info("Workflow generator: %s JSON parse recovered on retry", stage)
                return parsed
            last_detail = f"Non-object JSON: {type(parsed).__name__}"
            logger.info("Workflow generator: %s non-object JSON on attempt %s", stage, attempt + 1)
        raise _StageJSONError(stage, last_detail or "JSON parse failed")

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
        current_graph: dict[str, Any] | None = None,
    ) -> PlannerResultDict:
        user_prompt = PLANNER_USER_PROMPT.format(
            mode=mode,
            instruction=instruction.strip(),
            existing_graph_section=format_existing_graph_section(current_graph),
            ideal_output_section=format_ideal_output_section(ideal_output),
            tool_catalogue_section=format_tool_catalogue_section(tool_catalogue_text),
        )
        messages = [
            SystemPromptMessage(content=PLANNER_SYSTEM_PROMPT),
            UserPromptMessage(content=user_prompt),
        ]
        parsed = cls._invoke_and_parse_json(
            model_instance=model_instance,
            messages=messages,
            model_parameters=_clamp_for_planner(model_parameters),
            stage="Planner",
        )

        nodes = parsed.get("nodes")
        if not isinstance(nodes, list):
            raise _StageSchemaError("Planner", "missing 'nodes' array")
        for node in nodes:
            if not isinstance(node, dict) or "node_type" not in node:
                raise _StageSchemaError("Planner", f"malformed node entry: {node!r}")

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
        current_graph: dict[str, Any] | None = None,
    ) -> GraphDict:
        user_prompt = BUILDER_USER_PROMPT.format(
            instruction=instruction.strip(),
            ideal_output_section=format_ideal_output_section(ideal_output),
            existing_graph_section=format_builder_existing_graph_section(current_graph),
            provider=provider,
            name=model_name,
            mode_label=model_mode,
            plan_block=format_plan_block(plan_nodes),
            tool_catalogue_section=format_builder_tool_catalogue_section(tool_catalogue_text),
            start_inputs_section=format_start_inputs_section(start_inputs or []),
        )
        # Scope the builder cheatsheet to exactly the node types the planner
        # chose, so the prompt carries each type's FULL schema (e.g. a file
        # start variable's required ``allowed_file_types``) without dragging in
        # config for unrelated node types.
        plan_node_types = {
            str(node.get("node_type") or "").strip() for node in plan_nodes if str(node.get("node_type") or "").strip()
        }
        messages = [
            SystemPromptMessage(content=get_builder_system_prompt(mode, plan_node_types)),
            UserPromptMessage(content=user_prompt),
        ]
        parsed = cls._invoke_and_parse_json(
            model_instance=model_instance,
            messages=messages,
            model_parameters=model_parameters,
            stage="Builder",
        )

        nodes = parsed.get("nodes")
        edges = parsed.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise _StageSchemaError("Builder", "graph missing 'nodes' or 'edges' arrays")

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

        # Defensive ID remap: Dify's run-time placeholder regex only accepts
        # ``[a-zA-Z0-9_]`` in the node-id slot, so anything the LLM emits with
        # hyphens, dots, or spaces (``node-1``, ``node.2``, etc.) would break
        # every placeholder pointing at it. Sanitize every id + every
        # cross-reference (edges' ``source`` / ``target``, ``parentId``,
        # ``start_node_id`` / ``iteration_id`` / ``loop_id`` on data, and the
        # ``{{#…#}}`` and ``["node-id", "var"]`` references) BEFORE the rest
        # of the postprocess pass touches them.
        cls._sanitize_node_ids(nodes=nodes, edges=edges)

        # Container-child nodes carry their own relative positions inside the
        # parent and have a special ``type`` (custom-iteration-start /
        # custom-loop-start). We must not override their positions or wrapper
        # ``type``; only top-level (parentId-less) nodes get the layered
        # auto layout (x = topological depth, y = lane within the layer).
        cls._layout_top_level_nodes(nodes=nodes, edges=edges)
        for node in nodes:
            cls._fill_node_defaults(node)
            if node.get("parentId"):
                # Inner node — keep whatever the LLM emitted; only fill the
                # absolutely-required defaults so the canvas can render it.
                node.setdefault("zIndex", 1002)
                node.setdefault("extent", "parent")
            # Inner nodes keep their LLM-emitted relative position; top-level
            # nodes were positioned by the layered layout. The setdefault only
            # fires for inner nodes without a position and for a (broken)
            # id-less node the layout pass couldn't see.
            node.setdefault("position", {"x": 0.0, "y": 0.0})
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

        # Branch nodes (if-else / question-classifier) emit one handle per
        # case; an edge leaving them on the default "source" handle dangles
        # off a handle that doesn't exist on the canvas. Repair the
        # unambiguous cases before edge ids are computed from the handles.
        cls._repair_branch_edge_handles(nodes=nodes, edges=edges)

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

        # Schema backstop: a "file" / "file-list" start variable MUST carry a
        # non-empty ``allowed_file_types`` or Studio refuses to load the draft
        # ("supported file types is required"). The builder is now told to set
        # it, but we fill safe defaults for any variable that still lacks it so
        # the generated workflow always loads and runs.
        cls._normalize_start_file_variables(nodes=nodes)

        return cast(GraphDict, {"nodes": nodes, "edges": deduped_edges, "viewport": viewport})

    # ------------------------------------------------------------------
    # Variable-reference reconciliation
    # ------------------------------------------------------------------

    # Detects ``{{#node_id.var#}}`` placeholders. We match the EXACT regex
    # Dify's workflow runtime uses (see
    # ``graphon.runtime.variable_pool.VARIABLE_PATTERN``):
    #
    #     \{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10})#\}\}
    #
    # Two consequences for the generator:
    #   1. Node ids MUST be ``[a-zA-Z0-9_]`` — letters, digits, underscores.
    #      A hyphenated id like ``node-1`` does NOT match at run time, so the
    #      whole ``{{#node-1.var#}}`` survives into the LLM prompt literally
    #      and the LLM at run time echoes it back as the answer. The
    #      postprocess remap below defensively rewrites any hyphen the
    #      builder LLM still produces.
    #   2. The walker must match the same regex so we don't auto-fix
    #      references the runtime would never resolve anyway.
    _VAR_REF_RE: ClassVar = re.compile(
        r"\{\{#([a-zA-Z0-9_]{1,50})\.([a-zA-Z_][a-zA-Z0-9_]{0,29}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){0,9})#\}\}"
    )

    # Lenient sibling used only by the defensive id-sanitize pass — it
    # accepts ANY character in the node-id slot (except the ``.`` separator
    # and ``#`` terminator) so we can rewrite the LLM's ``{{#node-1.var#}}``
    # / ``{{#node 2.var#}}`` outputs BEFORE the strict walker sees them.
    # Never use this for validation, only for rewriting.
    _LENIENT_VAR_REF_RE: ClassVar = re.compile(r"\{\{#([^#.{}]+)\.([^#]+)#\}\}")

    # Characters the run-time placeholder regex rejects in the node-id slot.
    # Anything matching this in a node id must be sanitized away.
    _INVALID_ID_CHARS_RE: ClassVar = re.compile(r"[^a-zA-Z0-9_]")

    # Strings inside ``data`` that look like node-id slugs and need
    # remapping when we defensively sanitize LLM-emitted ids.
    _ID_FIELDS: ClassVar = frozenset({"start_node_id", "iteration_id", "loop_id", "parentId"})

    # ``data`` keys whose value is a plain string list, never a
    # ``[node_id, var]`` value-selector — so the reference walker must not read
    # a 2-element one as a selector. ``default`` holds an input's default value;
    # ``options`` holds select choices; the ``allowed_file_*`` keys hold a file
    # variable's upload config (types / extensions / methods).
    _NON_SELECTOR_LIST_KEYS: ClassVar = frozenset(
        {
            "default",
            "options",
            "allowed_file_types",
            "allowed_file_extensions",
            "allowed_file_upload_methods",
        }
    )

    @classmethod
    def _reconcile_variable_references(cls, *, nodes: list[dict[str, Any]], mode: WorkflowGenerationMode) -> None:
        """
        Walk every variable reference, ensure it resolves; auto-fix missing
        start-node variables (the safe, dominant case) by adding a stub
        ``paragraph`` entry to ``start.data.variables``.

        For Advanced-Chat mode, ``sys.query`` and ``sys.files`` are always
        treated as resolved without any declaration. Tool nodes' parameter
        references aren't validated here because we don't know each tool's
        schema — the run time validates those.
        """
        nodes_by_id: dict[str, dict[str, Any]] = {n.get("id", ""): n for n in nodes if n.get("id")}
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
                # flat 2-element list of strings. Skip keys whose value is a
                # plain string list that merely HAPPENS to have two entries —
                # a 2-option ``select`` or a file variable's two allowed upload
                # methods are NOT ``[node_id, var]`` selectors and must not be
                # mistaken for references.
                if (
                    isinstance(v, list)
                    and len(v) == 2
                    and all(isinstance(x, str) for x in v)
                    and k not in cls._NON_SELECTOR_LIST_KEYS
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
            return any(isinstance(v, dict) and v.get("variable") == var for v in (data.get("variables") or []))
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
            return any(isinstance(p, dict) and p.get("name") == var for p in (data.get("parameters") or []))
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
        if node_type == BuiltinNodeTypes.DOCUMENT_EXTRACTOR:
            # Single ``text`` output: a string, or an array of strings when
            # ``is_array_file`` is set.
            return var == "text"
        if node_type in (BuiltinNodeTypes.VARIABLE_AGGREGATOR, BuiltinNodeTypes.LEGACY_VARIABLE_AGGREGATOR):
            return var == "output"
        if node_type == BuiltinNodeTypes.LIST_OPERATOR:
            return var in {"result", "first_record", "last_record"}
        # Other node types (if-else, iteration-start, loop-start, ...) don't
        # produce outputs of their own.
        return False

    @classmethod
    def _sanitize_node_ids(cls, *, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        """
        Rewrite every node id to ``[a-zA-Z0-9_]`` and fix every cross-reference.

        Dify's run-time ``VARIABLE_PATTERN`` accepts only ``[a-zA-Z0-9_]`` in
        the node-id slot of ``{{#…#}}`` placeholders. The builder LLM often
        emits ``node-1`` style ids (and occasionally dots or spaces); left
        unfixed those make every placeholder silently fail at run time, the
        literal ``{{#node-1.var#}}`` survives into the prompt, and the LLM at
        run time echoes it back as the user's output — the bug we are here
        to kill.

        Approach: build a one-to-one ``old → new`` map by dropping the invalid
        characters — collision-safe: when the sanitized id is already taken
        (e.g. the builder emitted BOTH ``node-1`` and ``node1``) a numeric
        suffix keeps the two distinct instead of silently merging every
        reference onto one node. Then rewrite (a) every node ``id``, (b) every
        edge ``source`` / ``target``, (c) every ``parentId`` /
        ``start_node_id`` / ``iteration_id`` / ``loop_id`` inside ``data``,
        (d) every ``{{#…#}}`` reference in any string, (e) every
        ``["node-id", "var"]`` value-selector list. We do NOT rename variable
        names — only ids.
        """
        id_map: dict[str, str] = {}
        # Ids that are already valid are reserved up front so a sanitized id
        # can never collide with an untouched sibling.
        used: set[str] = {
            n["id"] for n in nodes if isinstance(n.get("id"), str) and not cls._INVALID_ID_CHARS_RE.search(n["id"])
        }
        fallback_seq = 0
        for node in nodes:
            old = node.get("id")
            if not isinstance(old, str) or not cls._INVALID_ID_CHARS_RE.search(old):
                continue
            base = cls._INVALID_ID_CHARS_RE.sub("", old)
            if not base:
                # Id was nothing but invalid characters (e.g. "节点", "--").
                fallback_seq += 1
                base = f"node_{fallback_seq}"
            new = base
            suffix = 2
            while new in used:
                new = f"{base}_{suffix}"
                suffix += 1
            used.add(new)
            id_map[old] = new
            node["id"] = new
        if not id_map:
            return

        # Rewrite edges' source / target.
        for edge in edges:
            for key in ("source", "target"):
                v = edge.get(key)
                if isinstance(v, str) and v in id_map:
                    edge[key] = id_map[v]
            # Also rewrite the edge id if the builder emitted one referencing
            # the old ids; the dedupe pass later recomputes it anyway, but
            # rewriting here keeps logs sane. Longest-first so an id that is
            # a substring of another (``node-1`` in ``node-12``) can't corrupt
            # the longer match.
            eid = edge.get("id")
            if isinstance(eid, str):
                for old, new in sorted(id_map.items(), key=lambda kv: -len(kv[0])):
                    eid = eid.replace(old, new)
                edge["id"] = eid

        # Rewrite every reference inside any node's data (recursively) plus
        # the wrapper-level ``parentId`` — ReactFlow stores parentId on the
        # node wrapper, but the LLM occasionally emits it inside ``data``
        # too. We cover both spots so the strip is symmetric.
        for node in nodes:
            wrapper_parent = node.get("parentId")
            if isinstance(wrapper_parent, str) and wrapper_parent in id_map:
                node["parentId"] = id_map[wrapper_parent]
            data = node.get("data")
            if isinstance(data, dict):
                cls._rewrite_refs_in_data(data, id_map)

    @classmethod
    def _rewrite_refs_in_data(cls, value: Any, id_map: dict[str, str]) -> None:
        """Recursive sibling of ``_collect_refs_in_data`` that does rewrites."""
        match value:
            case dict():
                for k, v in list(value.items()):
                    if k in cls._ID_FIELDS and isinstance(v, str):
                        # Direct id field — apply the longest matching prefix
                        # (handles ``"nodeKstart"`` where ``nodeK`` is the
                        # container's old id).
                        for old, new in sorted(id_map.items(), key=lambda kv: -len(kv[0])):
                            if old in v:
                                value[k] = v.replace(old, new)
                                v = value[k]
                    match v:
                        case str():
                            rewritten = cls._LENIENT_VAR_REF_RE.sub(lambda m: cls._rewrite_var_ref(m, id_map), v)
                            if rewritten != v:
                                value[k] = rewritten
                        case [str(v0), str(v1)] if v0 in id_map:
                            # 2-element ``["node-id", "var"]`` selector list.
                            value[k] = [id_map[v0], v1]
                        case _:
                            cls._rewrite_refs_in_data(v, id_map)
            case list():
                for item in value:
                    cls._rewrite_refs_in_data(item, id_map)

    @classmethod
    def _rewrite_var_ref(cls, m: re.Match[str], id_map: dict[str, str]) -> str:
        node_id = m.group(1)
        rest = m.group(2)
        new_id = id_map.get(node_id, node_id)
        return f"{{{{#{new_id}.{rest}#}}}}"

    @classmethod
    def _repair_branch_edge_handles(cls, *, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        """
        Re-home edges that leave a branch node on the default "source" handle.

        if-else exposes one source handle per ``case_id`` plus the implicit
        "false" (ELSE) handle; question-classifier exposes one per class id.
        The builder prompt documents this, but LLMs still emit the default
        handle, which renders as an edge hanging off a handle that doesn't
        exist and the branch silently never runs.

        Repair only when unambiguous: default-handle edges are assigned to the
        node's UNUSED branch handles in declaration order, and only when there
        are at least as many unused handles as edges to fix. Anything
        ambiguous is left alone — a wrong guess that swaps the IF and ELSE
        arms is worse than a visible dangling edge.
        """
        for node in nodes:
            data = node.get("data") or {}
            node_type = data.get("type")
            if node_type == BuiltinNodeTypes.IF_ELSE:
                branch_handles = [
                    str(case["case_id"])
                    for case in (data.get("cases") or [])
                    if isinstance(case, dict) and case.get("case_id")
                ]
                # ELSE is implicit — it has a handle even though no case
                # declares it.
                branch_handles.append("false")
            elif node_type == BuiltinNodeTypes.QUESTION_CLASSIFIER:
                branch_handles = [
                    str(klass["id"])
                    for klass in (data.get("classes") or [])
                    if isinstance(klass, dict) and klass.get("id")
                ]
            else:
                continue

            node_id = node.get("id")
            outgoing = [e for e in edges if e.get("source") == node_id]
            taken = {e.get("sourceHandle") for e in outgoing if e.get("sourceHandle") in branch_handles}
            unused = [h for h in branch_handles if h not in taken]
            defaulted = [e for e in outgoing if e.get("sourceHandle") in (None, "", "source")]
            if not defaulted or len(defaulted) > len(unused):
                continue
            for edge, handle in zip(defaulted, unused):
                edge["sourceHandle"] = handle
                logger.info(
                    "Workflow generator: re-homed default-handle edge %s -> %s onto branch handle %r",
                    node_id,
                    edge.get("target"),
                    handle,
                )

    @classmethod
    def _layout_top_level_nodes(cls, *, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
        """
        Lay out top-level nodes by graph topology instead of array order.

        x = longest-path depth from the entry layer, y = lane within the
        layer — so an if-else's two arms render as two parallel rows instead
        of overlapping on one line, and a builder that emits nodes out of
        execution order still gets a left-to-right canvas. Longest-path (not
        BFS) layering keeps a join node (variable-aggregator, end) to the
        right of its deepest branch.

        Cycle-safe: Kahn's algorithm simply never reaches nodes on a cycle,
        and those get parked one layer past the deepest laid-out node in
        declaration order — the cycle itself is flagged by the structural
        validator afterwards.
        """
        top_level = [n for n in nodes if not n.get("parentId") and isinstance(n.get("id"), str) and n.get("id")]
        id_set = {n["id"] for n in top_level}

        succs: dict[str, list[str]] = {node_id: [] for node_id in id_set}
        indegree: dict[str, int] = dict.fromkeys(id_set, 0)
        seen_pairs: set[tuple[str, str]] = set()
        for edge in edges:
            src, tgt = edge.get("source"), edge.get("target")
            if not isinstance(src, str) or not isinstance(tgt, str):
                continue
            if src not in id_set or tgt not in id_set or src == tgt or (src, tgt) in seen_pairs:
                continue
            seen_pairs.add((src, tgt))
            succs[src].append(tgt)
            indegree[tgt] += 1

        depth: dict[str, int] = {}
        queue = [n["id"] for n in top_level if indegree[n["id"]] == 0]
        for node_id in queue:
            depth[node_id] = 0
        while queue:
            cur = queue.pop(0)
            for nxt in succs[cur]:
                depth[nxt] = max(depth.get(nxt, 0), depth[cur] + 1)
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)

        overflow_depth = (max(depth.values()) + 1) if depth else 0
        lanes: dict[int, int] = {}
        for node in top_level:
            d = depth.get(node["id"], overflow_depth)
            lane = lanes.get(d, 0)
            lanes[d] = lane + 1
            node["position"] = {
                "x": float(_NODE_X_OFFSET + _NODE_X_STEP * d),
                "y": float(_NODE_Y + _NODE_Y_STEP * lane),
            }

    @classmethod
    def _inject_start_variable(cls, start_node: dict[str, Any], var: str) -> None:
        """Add a default ``paragraph`` input so ``{{#start.<var>#}}`` resolves."""
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
    def _normalize_start_file_variables(cls, *, nodes: list[dict[str, Any]]) -> None:
        """
        Fill the required upload config on every file / file-list start variable.

        A start variable of type ``file`` / ``file-list`` is invalid without a
        non-empty ``allowed_file_types`` — Studio rejects the draft with
        "supported file types is required" (see the front-end validator in
        ``config-var/config-modal/utils.ts``) and the workflow never runs. The
        builder prompt now documents these fields, but LLMs still drop them, so
        we backfill safe defaults here:

          * a start variable a ``document-extractor`` consumes but that wasn't
            declared as a file type → promoted to ``file`` (or ``file-list``
            when the extractor's ``is_array_file`` is set), defaulting its
            allowed types to ``["document"]`` (what extraction needs);
          * empty / missing ``allowed_file_types`` → every standard file type;
          * ``custom`` present without ``allowed_file_extensions`` → drop
            ``custom`` (it would otherwise require a non-empty extension list);
          * empty / missing ``allowed_file_upload_methods`` → local + remote;
          * ensure ``allowed_file_extensions`` is at least an empty list.

        Idempotent: a variable that already declares valid file config is left
        untouched.
        """
        start_node = next(
            (n for n in nodes if (n.get("data") or {}).get("type") == BuiltinNodeTypes.START),
            None,
        )
        if start_node is None:
            return
        variables = (start_node.get("data") or {}).get("variables")
        if not isinstance(variables, list):
            return

        # Start variables a document-extractor reads → whether it wants an
        # array (file-list). These MUST be file inputs even if the builder
        # mistyped them (e.g. declared "paragraph"), or the extractor fails at
        # run time. ``["document"]`` is the right default for text extraction.
        extractor_file_vars = cls._document_extractor_start_vars(nodes=nodes, start_id=start_node.get("id", ""))

        for var in variables:
            if not isinstance(var, dict):
                continue
            name = var.get("variable")
            if name in extractor_file_vars and var.get("type") not in _FILE_VARIABLE_TYPES:
                var["type"] = "file-list" if extractor_file_vars[name] else "file"
                var.setdefault("allowed_file_types", ["document"])
            if var.get("type") not in _FILE_VARIABLE_TYPES:
                continue
            allowed_types = var.get("allowed_file_types")
            if not isinstance(allowed_types, list) or not allowed_types:
                allowed_types = list(_DEFAULT_ALLOWED_FILE_TYPES)
                var["allowed_file_types"] = allowed_types
            # ``custom`` demands a non-empty extension list; without one, drop it
            # so the variable doesn't trip the "file extensions required" check.
            extensions = var.get("allowed_file_extensions")
            has_extensions = isinstance(extensions, list) and bool(extensions)
            if "custom" in allowed_types and not has_extensions:
                pruned = [t for t in allowed_types if t != "custom"]
                var["allowed_file_types"] = pruned or list(_DEFAULT_ALLOWED_FILE_TYPES)
            methods = var.get("allowed_file_upload_methods")
            if not isinstance(methods, list) or not methods:
                var["allowed_file_upload_methods"] = list(_DEFAULT_FILE_UPLOAD_METHODS)
            if not isinstance(var.get("allowed_file_extensions"), list):
                var["allowed_file_extensions"] = []

    @classmethod
    def _document_extractor_start_vars(cls, *, nodes: list[dict[str, Any]], start_id: str) -> dict[str, bool]:
        """
        Map start-variable name → ``is_array_file`` for every start variable a
        ``document-extractor`` node reads via its ``variable_selector``.

        When two extractors read the same variable we keep ``True`` (file-list)
        if any of them wants an array, since a file-list also satisfies a
        single-file read.
        """
        out: dict[str, bool] = {}
        if not start_id:
            return out
        for node in nodes:
            data = node.get("data") or {}
            if data.get("type") != BuiltinNodeTypes.DOCUMENT_EXTRACTOR:
                continue
            selector = data.get("variable_selector")
            if isinstance(selector, list) and len(selector) == 2 and selector[0] == start_id:
                var_name = selector[1]
                out[var_name] = out.get(var_name, False) or bool(data.get("is_array_file"))
        return out

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
    _CONTAINER_TYPES: ClassVar = frozenset({BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP})

    @classmethod
    def _validate_structure(
        cls,
        *,
        graph: GraphDict,
        mode: WorkflowGenerationMode,
        installed_tools: set[tuple[str, str]] | None = None,
    ) -> list[WorkflowGenerateErrorDict]:
        """
        Return a list of structured errors for every violation found.

        Catches:
          * exactly-one ``start`` node + mode-aware terminal (``end`` for
            workflow, ``answer`` for advanced-chat);
          * edges whose endpoints don't exist;
          * dangling ``parentId`` / ``start_node_id`` / ``iteration_id`` /
            ``loop_id`` references inside node ``data``;
          * container nodes (iteration / loop) without children, children
            whose ``parentId`` points at a non-container, and cycles in the
            parent chain;
          * variable references (``{{#node.var#}}`` / value selectors) that
            point at a node which does NOT declare the variable;
          * tool nodes naming a ``(provider, tool)`` pair the tenant hasn't
            installed.

        Per-node config validation (model spec, prompt template shape, etc.)
        is deferred to ``WorkflowService.sync_draft_workflow``; we only fail
        on structural issues the user must know about so they don't get a
        broken-at-runtime draft.
        """
        errors: list[WorkflowGenerateErrorDict] = []

        nodes_raw = graph.get("nodes", [])
        nodes: list[dict[str, Any]] = list(cast(list[dict[str, Any]], nodes_raw))
        if not nodes:
            errors.append(_err(WorkflowGenerateErrorCode.INVALID_SCHEMA, "Generated graph has no nodes"))
            return errors

        # Duplicate ids make every cross-reference ambiguous (edges, variable
        # placeholders, parentId all resolve to "whichever node wins"), so a
        # graph with them is unusable no matter how the canvas renders it.
        id_counts: dict[str, int] = {}
        for node in nodes:
            node_id = node.get("id", "")
            if node_id:
                id_counts[node_id] = id_counts.get(node_id, 0) + 1
        for node_id, count in id_counts.items():
            if count > 1:
                errors.append(
                    _err(
                        WorkflowGenerateErrorCode.DUPLICATE_NODE_ID,
                        f"Duplicate node id {node_id!r} ({count} nodes share it)",
                        node_id=node_id,
                    )
                )

        types = [node.get("data", {}).get("type", "") for node in nodes]
        starts = [t for t in types if t == BuiltinNodeTypes.START]
        if len(starts) != 1:
            errors.append(
                _err(
                    WorkflowGenerateErrorCode.MISSING_START,
                    f"Workflow must have exactly one 'start' node (found {len(starts)})",
                )
            )

        if mode == "advanced-chat":
            terminal_count = sum(1 for t in types if t == BuiltinNodeTypes.ANSWER)
            terminal_name = "answer"
        else:
            terminal_count = sum(1 for t in types if t == BuiltinNodeTypes.END)
            terminal_name = "end"
        if terminal_count < 1:
            errors.append(
                _err(
                    WorkflowGenerateErrorCode.MISSING_TERMINAL,
                    f"Workflow must end with at least one '{terminal_name}' node",
                )
            )

        # Edges must reference real node ids.
        known_ids: set[str] = {node.get("id", "") for node in nodes if node.get("id")}
        for edge in graph.get("edges", []):
            src = edge.get("source")
            tgt = edge.get("target")
            if src not in known_ids:
                errors.append(_err(WorkflowGenerateErrorCode.DANGLING_EDGE, f"Edge source node not found: {src!r}"))
            if tgt not in known_ids:
                errors.append(_err(WorkflowGenerateErrorCode.DANGLING_EDGE, f"Edge target node not found: {tgt!r}"))

        # Workflow graphs must be DAGs — a directed cycle hangs or errors the
        # run, and nothing downstream of the cycle ever executes. (A "loop"
        # container is the sanctioned way to iterate; its edges are internal.)
        errors.extend(cls._collect_edge_cycle_errors(graph=graph, known_ids=known_ids))

        # Dangling node-id references in node ``data`` (parentId, start_node_id, iteration_id, loop_id).
        errors.extend(cls._collect_dangling_id_refs(nodes=nodes, known_ids=known_ids))

        # Container topology.
        errors.extend(cls._collect_container_errors(nodes=nodes))

        # Tool catalogue check — only run if the caller wired in a catalogue.
        if installed_tools is not None:
            errors.extend(cls._collect_unknown_tools(nodes=nodes, installed_tools=installed_tools))

        # Variable-reference resolution — walks ``{{#node.var#}}`` placeholders
        # and value selectors and flags anything pointing at a node that
        # doesn't declare the variable. Start-node refs are auto-fixed
        # earlier in postprocess, so anything that survives to here is
        # genuinely unresolvable.
        errors.extend(cls._collect_unresolved_refs(nodes=nodes, mode=mode))

        return errors

    @classmethod
    def _collect_edge_cycle_errors(cls, *, graph: GraphDict, known_ids: set[str]) -> list[WorkflowGenerateErrorDict]:
        """
        Flag directed cycles among the graph's edges (Kahn's algorithm).

        Self-loops are reported per node; a longer cycle is reported once,
        naming every node Kahn's peeling never reaches (cycle members plus
        anything downstream of them). Edges into unknown ids are ignored
        here — the dangling-edge check already covers those.
        """
        out: list[WorkflowGenerateErrorDict] = []
        succs: dict[str, list[str]] = {node_id: [] for node_id in known_ids}
        indegree: dict[str, int] = dict.fromkeys(known_ids, 0)
        for edge in graph.get("edges", []):
            src, tgt = edge.get("source"), edge.get("target")
            if src not in known_ids or tgt not in known_ids:
                continue
            if src == tgt:
                out.append(
                    _err(
                        WorkflowGenerateErrorCode.GRAPH_CYCLE,
                        f"Node {src!r} has an edge pointing at itself",
                        node_id=src,
                    )
                )
                continue
            succs[src].append(tgt)
            indegree[tgt] += 1

        queue = [node_id for node_id, deg in indegree.items() if deg == 0]
        visited = 0
        while queue:
            cur = queue.pop()
            visited += 1
            for nxt in succs[cur]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
        if visited < len(known_ids):
            trapped = sorted(node_id for node_id, deg in indegree.items() if deg > 0)
            out.append(
                _err(
                    WorkflowGenerateErrorCode.GRAPH_CYCLE,
                    f"Workflow graph contains a cycle; affected nodes: {', '.join(trapped)}",
                )
            )
        return out

    @classmethod
    def _collect_dangling_id_refs(
        cls, *, nodes: list[dict[str, Any]], known_ids: set[str]
    ) -> list[WorkflowGenerateErrorDict]:
        """Flag ``parentId`` / ``start_node_id`` / ``iteration_id`` / ``loop_id`` pointing nowhere.

        ``parentId`` is checked at BOTH the node wrapper and inside ``data``
        because Dify's schema puts it on the wrapper (ReactFlow convention)
        but the LLM occasionally drops it into ``data`` too. Either spot is
        a real signal that we should validate.
        """
        out: list[WorkflowGenerateErrorDict] = []
        for node in nodes:
            node_id = node.get("id", "")
            data = node.get("data") or {}
            for field in cls._ID_FIELDS:
                ref = data.get(field)
                if isinstance(ref, str) and ref and ref not in known_ids:
                    out.append(
                        _err(
                            WorkflowGenerateErrorCode.UNKNOWN_NODE_REFERENCE,
                            f"Node {node_id!r} field {field!r} references unknown node: {ref!r}",
                            node_id=node_id,
                        )
                    )
            # Wrapper-level parentId (the ReactFlow canonical location).
            wrapper_parent = node.get("parentId")
            if isinstance(wrapper_parent, str) and wrapper_parent and wrapper_parent not in known_ids:
                out.append(
                    _err(
                        WorkflowGenerateErrorCode.UNKNOWN_NODE_REFERENCE,
                        f"Node {node_id!r} parentId references unknown node: {wrapper_parent!r}",
                        node_id=node_id,
                    )
                )
        return out

    @classmethod
    def _collect_container_errors(cls, *, nodes: list[dict[str, Any]]) -> list[WorkflowGenerateErrorDict]:
        """
        Validate iteration / loop topology:

          * every container has at least one child whose ``parentId``
            points at it;
          * every non-container node with a ``parentId`` points at a real
            container, not at a non-container node;
          * no cycles in the parent chain (a node cannot be its own
            ancestor).
        """
        out: list[WorkflowGenerateErrorDict] = []
        by_id: dict[str, dict[str, Any]] = {n.get("id", ""): n for n in nodes if n.get("id")}

        # Containers and the set of node-ids that have a parentId pointing at them.
        container_ids = {n.get("id", "") for n in nodes if n.get("data", {}).get("type") in cls._CONTAINER_TYPES}
        children_by_parent: dict[str, list[str]] = {cid: [] for cid in container_ids}
        for n in nodes:
            parent = (n.get("data") or {}).get("parentId") or n.get("parentId")
            if not isinstance(parent, str) or not parent:
                continue
            if parent in container_ids:
                children_by_parent.setdefault(parent, []).append(n.get("id", ""))
            elif parent in by_id:
                # Parent exists but isn't a container — that's a topology bug.
                out.append(
                    _err(
                        WorkflowGenerateErrorCode.INVALID_CONTAINER,
                        f"Node {n.get('id')!r} parentId {parent!r} is not an iteration or loop node",
                        node_id=n.get("id", ""),
                    )
                )
            # parent missing from by_id is already flagged by _collect_dangling_id_refs.

        for cid in container_ids:
            if not children_by_parent.get(cid):
                out.append(
                    _err(
                        WorkflowGenerateErrorCode.INVALID_CONTAINER,
                        f"Container node {cid!r} has no child nodes",
                        node_id=cid,
                    )
                )

        # Cycle detection — for each node, walk up parentId chain and
        # bail if we ever revisit a node we've already seen on the chain.
        for n in nodes:
            seen: set[str] = set()
            cur_id = n.get("id", "")
            cur: dict[str, Any] | None = n
            depth = 0
            while cur is not None and depth < 64:  # generous safety cap
                parent = (cur.get("data") or {}).get("parentId") or cur.get("parentId")
                if not isinstance(parent, str) or not parent:
                    break
                if parent == cur_id or parent in seen:
                    out.append(
                        _err(
                            WorkflowGenerateErrorCode.INVALID_CONTAINER,
                            f"Cycle detected in parentId chain at node {cur_id!r}",
                            node_id=cur_id,
                        )
                    )
                    break
                seen.add(parent)
                cur = by_id.get(parent)
                depth += 1
        return out

    @classmethod
    def _collect_unknown_tools(
        cls,
        *,
        nodes: list[dict[str, Any]],
        installed_tools: set[tuple[str, str]],
    ) -> list[WorkflowGenerateErrorDict]:
        """Flag tool nodes naming a provider / tool pair not in the catalogue."""
        out: list[WorkflowGenerateErrorDict] = []
        for n in nodes:
            data = n.get("data") or {}
            if data.get("type") != BuiltinNodeTypes.TOOL:
                continue
            # The builder is told to put the catalogue's ``provider_name``
            # into BOTH ``provider_id`` and ``provider_name``. Accept either
            # for the lookup so we don't false-fail on the rare case where
            # the LLM only populated one of the two fields.
            provider = str(data.get("provider_id") or data.get("provider_name") or "").strip()
            tool = str(data.get("tool_name") or "").strip()
            if not provider or not tool:
                out.append(
                    _err(
                        WorkflowGenerateErrorCode.UNKNOWN_TOOL,
                        f"Tool node {n.get('id')!r} missing provider / tool name",
                        node_id=n.get("id", ""),
                    )
                )
                continue
            if (provider, tool) not in installed_tools:
                out.append(
                    _err(
                        WorkflowGenerateErrorCode.UNKNOWN_TOOL,
                        f"Tool {provider}/{tool} is not installed for this tenant",
                        node_id=n.get("id", ""),
                    )
                )
        return out

    @classmethod
    def _collect_unresolved_refs(
        cls, *, nodes: list[dict[str, Any]], mode: WorkflowGenerationMode
    ) -> list[WorkflowGenerateErrorDict]:
        """
        Walk every variable reference and flag anything pointing at a node
        that doesn't declare it. The postprocess step has already
        auto-injected missing start-node variables, so by the time this
        runs only NON-start references should ever fail.
        """
        out: list[WorkflowGenerateErrorDict] = []
        by_id: dict[str, dict[str, Any]] = {n.get("id", ""): n for n in nodes if n.get("id")}

        refs: set[tuple[str, str]] = set()
        for node in nodes:
            cls._collect_refs_in_data(node.get("data") or {}, refs)

        for node_id, var in refs:
            if mode == "advanced-chat" and node_id == "sys":
                continue
            target = by_id.get(node_id)
            if target is None:
                out.append(
                    _err(
                        WorkflowGenerateErrorCode.UNKNOWN_NODE_REFERENCE,
                        f"Reference {{#{node_id}.{var}#}} points at unknown node {node_id!r}",
                        node_id=node_id,
                    )
                )
                continue
            if cls._declares_variable(target, var):
                continue
            out.append(
                _err(
                    WorkflowGenerateErrorCode.UNRESOLVED_REFERENCE,
                    f"Reference {{#{node_id}.{var}#}} not declared on node {node_id!r}",
                    node_id=node_id,
                )
            )
        return out


def _clamp_for_planner(params: dict[str, Any]) -> dict[str, Any]:
    """
    The planner needs only a tight, deterministic plan — clamp temperature
    and cap max_tokens so we don't burn budget. Returns a copy.

    Temperature above 0.5 is pinned back to 0.2 (the planner's output is a
    small node list; rambling only hurts). ``max_tokens`` gets a tight default
    ONLY when the caller didn't pin one — an explicit value is always honoured.
    Bounding it stops a model that ignores the JSON instruction from generating
    until it hits the provider's (often huge) default ceiling.
    """
    out = dict(params)
    out.setdefault("temperature", 0.2)
    if "temperature" in out and isinstance(out["temperature"], (int, float)) and out["temperature"] > 0.5:
        out["temperature"] = 0.2
    out.setdefault("max_tokens", _PLANNER_DEFAULT_MAX_TOKENS)
    return out


def _label_from_variable(var: str) -> str:
    """Turn ``snake_case`` / ``camelCase`` into a Title-Cased UI label."""
    if not var:
        return ""
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", var).lower()
    return " ".join(part.capitalize() for part in snake.split("_") if part)


# Re-export json for callers / tests; keeps ruff happy when only the module is imported.
_ = json
