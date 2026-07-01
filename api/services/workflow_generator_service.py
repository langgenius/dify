"""
Workflow generator service.

Thin facade over ``core.workflow.generator.WorkflowGenerator`` that owns the
model-manager / model-instance plumbing. Controllers call this; the pure
domain class never touches the model registry directly.

Pattern mirrors ``LLMGenerator.generate_rule_config`` — see
``core/llm_generator/llm_generator.py`` — but lives in ``services/`` because
the generator output is consumed at the application layer (sync_draft_workflow,
createApp) rather than from inside another workflow.
"""

import logging
from collections.abc import Iterator
from typing import Any

from core.app.app_config.entities import ModelConfig
from core.llm_generator.llm_generator import LLMGenerator
from core.model_manager import ModelInstance, ModelManager
from core.workflow.generator import WorkflowGenerator
from core.workflow.generator.tool_catalogue import build_tool_catalogue, format_tool_catalogue, installed_tool_keys
from core.workflow.generator.types import (
    WorkflowGenerateResultDict,
    WorkflowGenerationMode,
    WorkflowGenerationModeRequest,
)
from graphon.model_runtime.entities.model_entities import ModelType

logger = logging.getLogger(__name__)


class WorkflowGeneratorService:
    """
    Coordinates model resolution with the workflow generator domain logic.

    Single public method (``generate_workflow_graph``) keeps the surface area
    minimal — the cmd+k `/create` flow is the only caller today.
    """

    @classmethod
    def generate_workflow_graph(
        cls,
        *,
        tenant_id: str,
        mode: WorkflowGenerationModeRequest,
        instruction: str,
        model_config: ModelConfig,
        ideal_output: str = "",
        current_graph: dict[str, Any] | None = None,
    ) -> WorkflowGenerateResultDict:
        """
        Resolve a model instance for the tenant and run the generator.

        ``mode`` accepts the ``"auto"`` sentinel — when set, the instruction is
        classified into a concrete ``workflow`` / ``advanced-chat`` mode (one
        tiny LLM call) before planning so the rest of the pipeline runs against
        a concrete mode. The resolved mode is echoed back under the result's
        ``mode`` key.

        ``current_graph`` is the existing draft graph for the cmd+k `/refine`
        flow — when present the generator refines it instead of creating a new
        graph from scratch. ``None`` is the `/create` path.

        Errors from the LLM call (auth, quota, invoke) propagate so the
        controller can map them to existing HTTP error envelopes (same
        envelope as ``/rule-generate``).
        """
        resolved_mode = cls._resolve_mode(
            tenant_id=tenant_id, mode=mode, instruction=instruction, model_config=model_config
        )
        model_instance, model_parameters, tool_catalogue_text, installed_tools = cls._resolve_generation_context(
            tenant_id=tenant_id, model_config=model_config
        )

        return WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters=model_parameters,
            provider=model_config.provider,
            model_name=model_config.name,
            model_mode=model_config.mode.value,
            mode=resolved_mode,
            instruction=instruction,
            ideal_output=ideal_output,
            tool_catalogue_text=tool_catalogue_text,
            installed_tools=installed_tools,
            current_graph=current_graph,
        )

    @classmethod
    def generate_workflow_graph_stream(
        cls,
        *,
        tenant_id: str,
        mode: WorkflowGenerationModeRequest,
        instruction: str,
        model_config: ModelConfig,
        ideal_output: str = "",
        current_graph: dict[str, Any] | None = None,
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """
        Streaming sibling of ``generate_workflow_graph``.

        Resolves the same model instance / tool catalogue / concrete mode, then
        delegates to ``WorkflowGenerator.generate_workflow_graph_stream`` and
        yields its ``(event_name, payload)`` tuples through to the controller's
        SSE writer. Provider-init / invoke errors raised while resolving the
        model instance propagate to the caller (the controller emits them as a
        single ``result`` SSE event).
        """
        resolved_mode = cls._resolve_mode(
            tenant_id=tenant_id, mode=mode, instruction=instruction, model_config=model_config
        )
        model_instance, model_parameters, tool_catalogue_text, installed_tools = cls._resolve_generation_context(
            tenant_id=tenant_id, model_config=model_config
        )

        yield from WorkflowGenerator.generate_workflow_graph_stream(
            model_instance=model_instance,
            model_parameters=model_parameters,
            provider=model_config.provider,
            model_name=model_config.name,
            model_mode=model_config.mode.value,
            mode=resolved_mode,
            instruction=instruction,
            ideal_output=ideal_output,
            tool_catalogue_text=tool_catalogue_text,
            installed_tools=installed_tools,
            current_graph=current_graph,
        )

    @classmethod
    def _resolve_mode(
        cls,
        *,
        tenant_id: str,
        mode: WorkflowGenerationModeRequest,
        instruction: str,
        model_config: ModelConfig,
    ) -> WorkflowGenerationMode:
        """Resolve the request mode into a concrete generation mode.

        ``"auto"`` triggers a one-word LLM classification using the model the
        user already picked; everything else passes through unchanged. The
        classifier never raises (defaults to ``advanced-chat``), so ``auto``
        never blocks generation.
        """
        if mode == "auto":
            return LLMGenerator.classify_workflow_mode(
                tenant_id=tenant_id, instruction=instruction, model_config=model_config
            )
        return mode

    @classmethod
    def _resolve_generation_context(
        cls,
        *,
        tenant_id: str,
        model_config: ModelConfig,
    ) -> tuple[ModelInstance, dict[str, Any], str, set[tuple[str, str]] | None]:
        """Resolve the model instance, completion params, and tool catalogue.

        Build the installed-tool catalogue for this tenant so the planner /
        builder can pick concrete tools instead of inventing names, AND so the
        runner's validator can reject hallucinated tool names BEFORE the user
        clicks Apply. A failure here (plugin daemon unreachable, etc.) must not
        block generation — log and fall back to the no-tool path, which also
        disables tool validation in the runner (``None`` sentinel rather than
        empty set, so we don't reject every tool node just because we couldn't
        enumerate the catalogue).
        """
        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.provider,
            model=model_config.name,
        )

        model_parameters: dict[str, Any] = dict(model_config.completion_params or {})

        tool_catalogue_text = ""
        installed_tools: set[tuple[str, str]] | None = None
        try:
            entries = build_tool_catalogue(tenant_id)
            tool_catalogue_text = format_tool_catalogue(entries)
            installed_tools = installed_tool_keys(entries)
        except Exception:
            logger.exception("Workflow generator: failed to build tool catalogue for tenant %s", tenant_id)

        return model_instance, model_parameters, tool_catalogue_text, installed_tools
