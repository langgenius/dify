import json
from typing import Optional, cast

from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import ModelFeature
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.llm.entities import ModelConfig
from core.workflow.nodes.llm.llm_node import LLMNode
from core.workflow.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from extensions.ext_database import db
from models.workflow import WorkflowNodeExecutionStatus


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
        query = variable_pool.get_variable_value(node_data.query)
        if not query:
            raise ValueError("Query not found")
        
        model_instance, model_config = self._fetch_model_config(node_data.model)
        if not isinstance(model_instance.model_type_instance, LargeLanguageModel):
            raise ValueError("Model is not a Large Language Model")
        
        llm_model = model_instance.model_type_instance
        model_schema = llm_model.get_model_schema(model_config.model, model_config.credentials)
        if not model_schema:
            raise ValueError("Model schema not found")
        
        if set(model_schema.features or []) & set([ModelFeature.MULTI_TOOL_CALL, ModelFeature.MULTI_TOOL_CALL]):
            # use function call 
            prompt_messages, prompt_message_tools, stop = self._generate_function_call_prompt(node_data)
        else:
            # use prompt engineering
            prompt_messages, stop = self._generate_prompt_engineering_prompt(node_data)
            prompt_message_tools = []

        text, usage, tool_call = self._invoke_llm(
            node_data_model=node_data.model,
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            stop=stop,
        )

        error = ''

        if tool_call:
            result = self._extract_json_from_tool_call(tool_call)
        else:
            result = self._extract_complete_json_response(text)
            if not result:
                result = self._generate_default_result(node_data)
                error = "Failed to extract result from function call or text response, using empty result."

        try:
            result = self._validate_result(node_data, result)
        except Exception as e:
            error = str(e)

        # transform result into standard format
        result = self._transform_result(node_data, result)

        process_data = {
            'model_mode': model_config.mode,
            'prompts': PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                model_mode=model_config.mode,
                prompt_messages=prompt_messages
            ),
            'usage': jsonable_encoder(usage),
            'function': {} if not prompt_message_tools else jsonable_encoder(prompt_message_tools[0]),
        }

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={
                'query': query,
                'parameters': node_data.parameters,
                'instruction': node_data.instruction,
            },
            process_data=process_data,
            outputs={
                'error': error,
                'result': result,
            },
            metadata={
                NodeRunMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                NodeRunMetadataKey.TOTAL_PRICE: usage.total_price,
                NodeRunMetadataKey.CURRENCY: usage.currency
            }
        )

    def _invoke_llm(self, node_data_model: ModelConfig,
                    model_instance: ModelInstance,
                    prompt_messages: list[PromptMessage],
                    stop: list[str]) -> tuple[str, LLMUsage, Optional[AssistantPromptMessage.ToolCall]]:
        """
        Invoke large language model
        :param node_data_model: node data model
        :param model_instance: model instance
        :param prompt_messages: prompt messages
        :param stop: stop
        :return:
        """
        db.session.close()

        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=node_data_model.completion_params,
            stop=stop,
            stream=False,
            user=self.user_id,
        )

        # handle invoke result
        if not isinstance(invoke_result, LLMResult):
            raise ValueError(f"Invalid invoke result: {invoke_result}")
        
        text = invoke_result.message.content
        usage = invoke_result.usage
        tool_call = invoke_result.message.tool_calls[0] if invoke_result.message.tool_calls else None

        # deduct quota
        self.deduct_llm_quota(tenant_id=self.tenant_id, model_instance=model_instance, usage=usage)

        return text, usage, tool_call

    def _generate_function_call_prompt(self, 
        data: ParameterExtractorNodeData
    ) -> tuple[list[PromptMessage], list[PromptMessageTool], list[str]]:
        """
        Generate function call prompt.
        """

    def _generate_prompt_engineering_prompt(self, 
        data: ParameterExtractorNodeData
    ) -> tuple[list[PromptMessage], list[str]]:
        """
        Generate prompt engineering prompt.
        """
        model_mode = ModelMode.value_of(data.model.mode)

        if model_mode == ModelMode.COMPLETION:
            return self._generate_prompt_engineering_completion_prompt(data)
        elif model_mode == ModelMode.CHAT:
            return self._generate_prompt_engineering_chat_prompt(data)
        else:
            raise ValueError(f"Invalid model mode: {model_mode}")

    def _generate_prompt_engineering_completion_prompt(self,
        data: ParameterExtractorNodeData
    ) -> tuple[list[PromptMessage], list[str]]:
        """
        Generate completion prompt.
        """

    def _generate_prompt_engineering_chat_prompt(self,
        data: ParameterExtractorNodeData
    ) -> tuple[list[PromptMessage], list[str]]:
        """
        Generate chat prompt.
        """

    def _validate_result(self, data: ParameterExtractorNodeData, result: dict) -> dict:
        """
        Validate result.
        """

    def _transform_result(self, data: ParameterExtractorNodeData, result: dict) -> dict:
        """
        Transform result into standard format.
        """

    def _extract_complete_json_response(self, result: str) -> dict:
        """
        Extract complete json response.
        """

    def _extract_json_from_tool_call(self, tool_call: AssistantPromptMessage.ToolCall) -> dict:
        """
        Extract json from tool call.
        """
        return json.loads(tool_call.function.arguments)
    
    def _generate_default_result(self, data: ParameterExtractorNodeData) -> dict:
        """
        Generate default result.
        """