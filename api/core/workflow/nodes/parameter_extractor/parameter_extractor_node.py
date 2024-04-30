from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.parameter_extractor.entities import ParameterExtractorNodeData


class ParameterExtractorNode(BaseNode):
    """
    Parameter Extractor Node.
    """
    _node_data_cls = ParameterExtractorNodeData
    _node_type = NodeType.PARAMETER_EXTRACTOR

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run the node.
        """

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