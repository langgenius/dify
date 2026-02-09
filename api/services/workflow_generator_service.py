"""
Workflow Generator Service

Application service that coordinates workflow generation with model management.
This service bridges the architectural boundary between core.workflow (domain)
and core.model_manager (infrastructure).

Architecture:
- Service layer can depend on both core.workflow and core.model_manager
- Provides a clean facade for controllers
- Handles model instance creation and injection
"""

from collections.abc import Sequence

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.workflow.generator import WorkflowGenerator


class WorkflowGeneratorService:
    """
    Service for generating workflow flowcharts using LLM.

    Responsibilities:
    1. Obtain model instance from ModelManager
    2. Delegate workflow generation to WorkflowGenerator
    3. Handle any service-level error transformation
    """

    @classmethod
    def generate_workflow_flowchart(
        cls,
        tenant_id: str,
        instruction: str,
        model_config: dict,
        available_nodes: Sequence[dict[str, object]] | None = None,
        existing_nodes: Sequence[dict[str, object]] | None = None,
        existing_edges: Sequence[dict[str, object]] | None = None,
        available_tools: Sequence[dict[str, object]] | None = None,
        selected_node_ids: Sequence[str] | None = None,
        previous_workflow: dict[str, object] | None = None,
        regenerate_mode: bool = False,
        preferred_language: str | None = None,
        available_models: Sequence[dict[str, object]] | None = None,
        use_graph_builder: bool = False,
    ) -> dict:
        """
        Generate workflow flowchart from natural language instruction.

        This service method:
        1. Creates model instance from model_config (infrastructure concern)
        2. Invokes WorkflowGenerator with the model instance (domain logic)

        Args:
            tenant_id: Tenant identifier
            instruction: Natural language instruction for workflow
            model_config: Model configuration dict with provider, name, completion_params
            available_nodes: Available workflow nodes
            existing_nodes: Existing nodes (for modification mode)
            existing_edges: Existing edges (for modification mode)
            available_tools: Available tools for workflow
            selected_node_ids: Selected node IDs for refinement
            previous_workflow: Previous workflow data
            regenerate_mode: Whether in regeneration mode
            preferred_language: Preferred language for output
            available_models: Available model configurations
            use_graph_builder: Whether to use graph builder mode

        Returns:
            dict with workflow generation result containing:
                - intent: "generate" | "off_topic" | "error"
                - flowchart: Mermaid diagram (if successful)
                - nodes: List of workflow nodes
                - edges: List of workflow edges
                - message: Status message
                - warnings: List of validation warnings
                - error: Error message (if failed)

        Raises:
            Exception: If model instance creation fails
        """
        # Service layer responsibility: coordinate infrastructure
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        model_parameters = model_config.get("completion_params", {})

        # Delegate to domain layer with injected dependencies
        return WorkflowGenerator.generate_workflow_flowchart(
            model_instance=model_instance,
            model_parameters=model_parameters,
            instruction=instruction,
            available_nodes=available_nodes,
            existing_nodes=existing_nodes,
            existing_edges=existing_edges,
            available_tools=available_tools,
            selected_node_ids=selected_node_ids,
            previous_workflow=previous_workflow,
            regenerate_mode=regenerate_mode,
            preferred_language=preferred_language,
            available_models=available_models,
            use_graph_builder=use_graph_builder,
        )
