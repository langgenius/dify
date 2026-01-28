"""
Service for generating Nested Node LLM graph structures.

This service creates graph structures containing LLM nodes configured for
extracting values from list[PromptMessage] variables.
"""

from typing import Any

from sqlalchemy.orm import Session

from core.model_runtime.entities import LLMMode
from core.workflow.enums import NodeType
from services.model_provider_service import ModelProviderService
from services.workflow.entities import NestedNodeGraphRequest, NestedNodeGraphResponse, NestedNodeParameterSchema


class NestedNodeGraphService:
    """Service for generating Nested Node LLM graph structures."""

    def __init__(self, session: Session):
        self._session = session

    def generate_nested_node_id(self, node_id: str, parameter_name: str) -> str:
        """Generate nested node ID following the naming convention.

        Format: {node_id}_ext_{parameter_name}
        """
        return f"{node_id}_ext_{parameter_name}"

    def generate_nested_node_graph(self, tenant_id: str, request: NestedNodeGraphRequest) -> NestedNodeGraphResponse:
        """Generate a complete graph structure containing a Nested Node LLM node.

        Args:
            tenant_id: The tenant ID for fetching default model config
            request: The nested node graph generation request

        Returns:
            Complete graph structure with nodes, edges, and viewport
        """
        node_id = self.generate_nested_node_id(request.parent_node_id, request.parameter_key)
        model_config = self._get_default_model_config(tenant_id)
        node = self._build_nested_node_llm_node(
            node_id=node_id,
            parent_node_id=request.parent_node_id,
            context_source=request.context_source,
            parameter_schema=request.parameter_schema,
            model_config=model_config,
        )

        graph = {
            "nodes": [node],
            "edges": [],
            "viewport": {},
        }

        return NestedNodeGraphResponse(graph=graph)

    def _get_default_model_config(self, tenant_id: str) -> dict[str, Any]:
        """Get the default LLM model configuration for the tenant."""
        model_provider_service = ModelProviderService()
        default_model = model_provider_service.get_default_model_of_model_type(
            tenant_id=tenant_id,
            model_type="llm",
        )

        if default_model:
            return {
                "provider": default_model.provider.provider,
                "name": default_model.model,
                "mode": LLMMode.CHAT.value,
                "completion_params": {},
            }

        # Fallback to empty config if no default model is configured
        return {
            "provider": "",
            "name": "",
            "mode": LLMMode.CHAT.value,
            "completion_params": {},
        }

    def _build_nested_node_llm_node(
        self,
        *,
        node_id: str,
        parent_node_id: str,
        context_source: list[str],
        parameter_schema: NestedNodeParameterSchema,
        model_config: dict[str, Any],
    ) -> dict[str, Any]:
        """Build the Nested Node LLM node structure.

        The node uses:
        - $context in prompt_template to reference the PromptMessage list
        - structured_output for extracting the specific parameter
        - parent_node_id to associate with the parent node
        """
        prompt_template = [
            {
                "role": "system",
                "text": "Extract the required parameter value from the conversation context above.",
                "skill": False,
            },
            {"$context": context_source},
            {"role": "user", "text": "", "skill": False},
        ]

        structured_output = {
            "schema": {
                "type": "object",
                "properties": {
                    parameter_schema.name: {
                        "type": parameter_schema.type,
                        "description": parameter_schema.description,
                    }
                },
                "required": [parameter_schema.name],
                "additionalProperties": False,
            }
        }

        return {
            "id": node_id,
            "position": {"x": 0, "y": 0},
            "data": {
                "type": NodeType.LLM.value,
                "title": f"NestedNode: {parameter_schema.name}",
                "desc": f"Extract {parameter_schema.name} from conversation context",
                "parent_node_id": parent_node_id,
                "model": model_config,
                "prompt_template": prompt_template,
                "context": {
                    "enabled": False,
                    "variable_selector": None,
                },
                "vision": {
                    "enabled": False,
                },
                "memory": None,
                "structured_output_enabled": True,
                "structured_output": structured_output,
            },
        }
