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
from typing import Any

from core.app.app_config.entities import ModelConfig
from core.model_manager import ModelManager
from core.workflow.generator import WorkflowGenerator
from core.workflow.generator.types import WorkflowGenerateResultDict, WorkflowGenerationMode
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
        mode: WorkflowGenerationMode,
        instruction: str,
        model_config: ModelConfig,
        ideal_output: str = "",
    ) -> WorkflowGenerateResultDict:
        """
        Resolve a model instance for the tenant and run the generator.

        Errors from the LLM call (auth, quota, invoke) propagate so the
        controller can map them to existing HTTP error envelopes (same
        envelope as ``/rule-generate``).
        """
        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.provider,
            model=model_config.name,
        )

        model_parameters: dict[str, Any] = dict(model_config.completion_params or {})

        return WorkflowGenerator.generate_workflow_graph(
            model_instance=model_instance,
            model_parameters=model_parameters,
            provider=model_config.provider,
            model_name=model_config.name,
            model_mode=str(model_config.mode),
            mode=mode,
            instruction=instruction,
            ideal_output=ideal_output,
        )
