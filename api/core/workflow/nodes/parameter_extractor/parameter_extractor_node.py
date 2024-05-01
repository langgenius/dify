from typing import cast

from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import ModelFeature
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.simple_prompt_transform import ModelMode
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.llm.llm_node import LLMNode
from core.workflow.nodes.parameter_extractor.entities import ParameterExtractorNodeData


class ParameterExtractorNode(LLMNode):
    """
    Parameter Extractor Node.
    """
    _node_data_cls = ParameterExtractorNodeData
    _node_type = NodeType.PARAMETER_EXTRACTOR

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run the node.
        """

        node_data = cast(ParameterExtractorNodeData, self.node_data)
        model_instance, model_config = self._fetch_model_config(node_data.model)
        model_mode = ModelMode.value_of(node_data.model.mode)

        if not isinstance(model_instance.model_type_instance, LargeLanguageModel):
            raise ValueError("Model is not a Large Language Model")
        
        llm_model = model_instance.model_type_instance

        model_schema = llm_model.get_model_schema(model_config.model, model_config.credentials)

        if not model_schema:
            raise ValueError("Model schema not found")
        
        if set(model_schema.features or []) & set([ModelFeature.MULTI_TOOL_CALL, ModelFeature.MULTI_TOOL_CALL]):
            # use function call 
            pass
        else:
            # use prompt engineering
            pass

    def _generate_function_call_prompt(self, 
        data: ParameterExtractorNodeData
    ) -> tuple[list[PromptMessage], list[PromptMessageTool]]:
        """
        Generate function call prompt.
        """

    def _generate_prompt_engineering_prompt(self, 
        data: ParameterExtractorNodeData
    ) -> list[PromptMessage]:
        """
        Generate prompt engineering prompt.
        """

    def _generate_prompt_engineering_completion_prompt(self,
        data: ParameterExtractorNodeData
    ) -> list[PromptMessage]:
        """
        Generate completion prompt.
        """

    def _generate_prompt_engineering_chat_prompt(self,
        data: ParameterExtractorNodeData
    ) -> list[PromptMessage]:
        """
        Generate chat prompt.
        """

    def _validate_result(self, data: ParameterExtractorNodeData, result: dict) -> dict:
        """
        Validate result.
        """

    def _extract_complete_json_response(self, result: str) -> dict:
        """
        Extract complete json response.
        """