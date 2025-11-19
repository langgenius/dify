import contextlib
import json
import logging
import uuid
from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.file import File
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities import ImagePromptMessageContent
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    PromptMessageTool,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.variables.types import ArrayValidation, SegmentType
from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base import variable_template_parser
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.llm import ModelConfig, llm_utils
from core.workflow.runtime import VariablePool
from factories.variable_factory import build_segment_with_type

from .entities import ParameterExtractorNodeData
from .exc import (
    InvalidModelModeError,
    InvalidModelTypeError,
    InvalidNumberOfParametersError,
    InvalidSelectValueError,
    InvalidTextContentTypeError,
    InvalidValueTypeError,
    ModelSchemaNotFoundError,
    ParameterExtractorNodeError,
    RequiredParameterMissingError,
)
from .prompts import (
    CHAT_EXAMPLE,
    CHAT_GENERATE_JSON_PROMPT,
    CHAT_GENERATE_JSON_USER_MESSAGE_TEMPLATE,
    COMPLETION_GENERATE_JSON_PROMPT,
    FUNCTION_CALLING_EXTRACTOR_EXAMPLE,
    FUNCTION_CALLING_EXTRACTOR_NAME,
    FUNCTION_CALLING_EXTRACTOR_SYSTEM_PROMPT,
    FUNCTION_CALLING_EXTRACTOR_USER_TEMPLATE,
)

logger = logging.getLogger(__name__)


def extract_json(text):
    """
    From a given JSON started from '{' or '[' extract the complete JSON object.
    """
    stack = []
    for i, c in enumerate(text):
        if c in {"{", "["}:
            stack.append(c)
        elif c in {"}", "]"}:
            # check if stack is empty
            if not stack:
                return text[:i]
            # check if the last element in stack is matching
            if (c == "}" and stack[-1] == "{") or (c == "]" and stack[-1] == "["):
                stack.pop()
                if not stack:
                    return text[: i + 1]
            else:
                return text[:i]
    return None


class ParameterExtractorNode(Node):
    """
    Parameter Extractor Node.
    """

    node_type = NodeType.PARAMETER_EXTRACTOR

    _node_data: ParameterExtractorNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = ParameterExtractorNodeData.model_validate(data)

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    _model_instance: ModelInstance | None = None
    _model_config: ModelConfigWithCredentialsEntity | None = None

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        return {
            "model": {
                "prompt_templates": {
                    "completion_model": {
                        "conversation_histories_role": {"user_prefix": "Human", "assistant_prefix": "Assistant"},
                        "stop": ["Human:"],
                    }
                }
            }
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self):
        """
        Run the node.
        """
        node_data = self._node_data
        variable = self.graph_runtime_state.variable_pool.get(node_data.query)
        query = variable.text if variable else ""

        variable_pool = self.graph_runtime_state.variable_pool

        files = (
            llm_utils.fetch_files(
                variable_pool=variable_pool,
                selector=node_data.vision.configs.variable_selector,
            )
            if node_data.vision.enabled
            else []
        )

        model_instance, model_config = self._fetch_model_config(node_data.model)
        if not isinstance(model_instance.model_type_instance, LargeLanguageModel):
            raise InvalidModelTypeError("Model is not a Large Language Model")

        llm_model = model_instance.model_type_instance
        model_schema = llm_model.get_model_schema(
            model=model_config.model,
            credentials=model_config.credentials,
        )
        if not model_schema:
            raise ModelSchemaNotFoundError("Model schema not found")

        # fetch memory
        memory = llm_utils.fetch_memory(
            variable_pool=variable_pool,
            app_id=self.app_id,
            node_data_memory=node_data.memory,
            model_instance=model_instance,
        )

        if (
            set(model_schema.features or []) & {ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL}
            and node_data.reasoning_mode == "function_call"
        ):
            # use function call
            prompt_messages, prompt_message_tools = self._generate_function_call_prompt(
                node_data=node_data,
                query=query,
                variable_pool=self.graph_runtime_state.variable_pool,
                model_config=model_config,
                memory=memory,
                files=files,
                vision_detail=node_data.vision.configs.detail,
            )
        else:
            # use prompt engineering
            prompt_messages = self._generate_prompt_engineering_prompt(
                data=node_data,
                query=query,
                variable_pool=self.graph_runtime_state.variable_pool,
                model_config=model_config,
                memory=memory,
                files=files,
                vision_detail=node_data.vision.configs.detail,
            )

            prompt_message_tools = []

        inputs = {
            "query": query,
            "files": [f.to_dict() for f in files],
            "parameters": jsonable_encoder(node_data.parameters),
            "instruction": jsonable_encoder(node_data.instruction),
        }

        process_data = {
            "model_mode": model_config.mode,
            "prompts": PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                model_mode=model_config.mode, prompt_messages=prompt_messages
            ),
            "usage": None,
            "function": {} if not prompt_message_tools else jsonable_encoder(prompt_message_tools[0]),
            "tool_call": None,
            "model_provider": model_config.provider,
            "model_name": model_config.model,
        }

        try:
            text, usage, tool_call = self._invoke(
                node_data_model=node_data.model,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                tools=prompt_message_tools,
                stop=model_config.stop,
            )
            process_data["usage"] = jsonable_encoder(usage)
            process_data["tool_call"] = jsonable_encoder(tool_call)
            process_data["llm_text"] = text
        except ParameterExtractorNodeError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=inputs,
                process_data=process_data,
                outputs={"__is_success": 0, "__reason": str(e)},
                error=str(e),
                metadata={},
            )
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=inputs,
                process_data=process_data,
                outputs={"__is_success": 0, "__reason": "Failed to invoke model", "__error": str(e)},
                error=str(e),
                metadata={},
            )

        error = None

        if tool_call:
            result = self._extract_json_from_tool_call(tool_call)
        else:
            result = self._extract_complete_json_response(text)
            if not result:
                result = self._generate_default_result(node_data)
                error = "Failed to extract result from function call or text response, using empty result."

        try:
            result = self._validate_result(data=node_data, result=result or {})
        except ParameterExtractorNodeError as e:
            error = str(e)

        # transform result into standard format
        result = self._transform_result(data=node_data, result=result or {})

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs={
                "__is_success": 1 if not error else 0,
                "__reason": error,
                "__usage": jsonable_encoder(usage),
                **result,
            },
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
            },
            llm_usage=usage,
        )

    def _invoke(
        self,
        node_data_model: ModelConfig,
        model_instance: ModelInstance,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool],
        stop: list[str],
    ) -> tuple[str, LLMUsage, AssistantPromptMessage.ToolCall | None]:
        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=node_data_model.completion_params,
            tools=tools,
            stop=stop,
            stream=False,
            user=self.user_id,
        )

        # handle invoke result

        text = invoke_result.message.content or ""
        if not isinstance(text, str):
            raise InvalidTextContentTypeError(f"Invalid text content type: {type(text)}. Expected str.")

        usage = invoke_result.usage
        tool_call = invoke_result.message.tool_calls[0] if invoke_result.message.tool_calls else None

        # deduct quota
        llm_utils.deduct_llm_quota(tenant_id=self.tenant_id, model_instance=model_instance, usage=usage)

        return text, usage, tool_call

    def _generate_function_call_prompt(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_config: ModelConfigWithCredentialsEntity,
        memory: TokenBufferMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> tuple[list[PromptMessage], list[PromptMessageTool]]:
        """
        Generate function call prompt.
        """
        query = FUNCTION_CALLING_EXTRACTOR_USER_TEMPLATE.format(
            content=query, structure=json.dumps(node_data.get_parameter_json_schema())
        )

        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)
        rest_token = self._calculate_rest_token(node_data, query, variable_pool, model_config, "")
        prompt_template = self._get_function_calling_prompt_template(
            node_data, query, variable_pool, memory, rest_token
        )
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query="",
            files=files,
            context="",
            memory_config=node_data.memory,
            memory=None,
            model_config=model_config,
            image_detail_config=vision_detail,
        )

        # find last user message
        last_user_message_idx = -1
        for i, prompt_message in enumerate(prompt_messages):
            if prompt_message.role == PromptMessageRole.USER:
                last_user_message_idx = i

        # add function call messages before last user message
        example_messages = []
        for example in FUNCTION_CALLING_EXTRACTOR_EXAMPLE:
            id = uuid.uuid4().hex
            example_messages.extend(
                [
                    UserPromptMessage(content=example["user"]["query"]),
                    AssistantPromptMessage(
                        content=example["assistant"]["text"],
                        tool_calls=[
                            AssistantPromptMessage.ToolCall(
                                id=id,
                                type="function",
                                function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                    name=example["assistant"]["function_call"]["name"],
                                    arguments=json.dumps(example["assistant"]["function_call"]["parameters"]),
                                ),
                            )
                        ],
                    ),
                    ToolPromptMessage(
                        content="Great! You have called the function with the correct parameters.", tool_call_id=id
                    ),
                    AssistantPromptMessage(
                        content="I have extracted the parameters, let's move on.",
                    ),
                ]
            )

        prompt_messages = (
            prompt_messages[:last_user_message_idx] + example_messages + prompt_messages[last_user_message_idx:]
        )

        # generate tool
        tool = PromptMessageTool(
            name=FUNCTION_CALLING_EXTRACTOR_NAME,
            description="Extract parameters from the natural language text",
            parameters=node_data.get_parameter_json_schema(),
        )

        return prompt_messages, [tool]

    def _generate_prompt_engineering_prompt(
        self,
        data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_config: ModelConfigWithCredentialsEntity,
        memory: TokenBufferMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> list[PromptMessage]:
        """
        Generate prompt engineering prompt.
        """
        model_mode = ModelMode(data.model.mode)

        if model_mode == ModelMode.COMPLETION:
            return self._generate_prompt_engineering_completion_prompt(
                node_data=data,
                query=query,
                variable_pool=variable_pool,
                model_config=model_config,
                memory=memory,
                files=files,
                vision_detail=vision_detail,
            )
        elif model_mode == ModelMode.CHAT:
            return self._generate_prompt_engineering_chat_prompt(
                node_data=data,
                query=query,
                variable_pool=variable_pool,
                model_config=model_config,
                memory=memory,
                files=files,
                vision_detail=vision_detail,
            )
        else:
            raise InvalidModelModeError(f"Invalid model mode: {model_mode}")

    def _generate_prompt_engineering_completion_prompt(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_config: ModelConfigWithCredentialsEntity,
        memory: TokenBufferMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> list[PromptMessage]:
        """
        Generate completion prompt.
        """
        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)
        rest_token = self._calculate_rest_token(
            node_data=node_data, query=query, variable_pool=variable_pool, model_config=model_config, context=""
        )
        prompt_template = self._get_prompt_engineering_prompt_template(
            node_data=node_data, query=query, variable_pool=variable_pool, memory=memory, max_token_limit=rest_token
        )
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={"structure": json.dumps(node_data.get_parameter_json_schema())},
            query="",
            files=files,
            context="",
            memory_config=node_data.memory,
            memory=memory,
            model_config=model_config,
            image_detail_config=vision_detail,
        )

        return prompt_messages

    def _generate_prompt_engineering_chat_prompt(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_config: ModelConfigWithCredentialsEntity,
        memory: TokenBufferMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> list[PromptMessage]:
        """
        Generate chat prompt.
        """
        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)
        rest_token = self._calculate_rest_token(
            node_data=node_data, query=query, variable_pool=variable_pool, model_config=model_config, context=""
        )
        prompt_template = self._get_prompt_engineering_prompt_template(
            node_data=node_data,
            query=CHAT_GENERATE_JSON_USER_MESSAGE_TEMPLATE.format(
                structure=json.dumps(node_data.get_parameter_json_schema()), text=query
            ),
            variable_pool=variable_pool,
            memory=memory,
            max_token_limit=rest_token,
        )

        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query="",
            files=files,
            context="",
            memory_config=node_data.memory,
            memory=None,
            model_config=model_config,
            image_detail_config=vision_detail,
        )

        # find last user message
        last_user_message_idx = -1
        for i, prompt_message in enumerate(prompt_messages):
            if prompt_message.role == PromptMessageRole.USER:
                last_user_message_idx = i

        # add example messages before last user message
        example_messages = []
        for example in CHAT_EXAMPLE:
            example_messages.extend(
                [
                    UserPromptMessage(
                        content=CHAT_GENERATE_JSON_USER_MESSAGE_TEMPLATE.format(
                            structure=json.dumps(example["user"]["json"]),
                            text=example["user"]["query"],
                        )
                    ),
                    AssistantPromptMessage(
                        content=json.dumps(example["assistant"]["json"]),
                    ),
                ]
            )

        prompt_messages = (
            prompt_messages[:last_user_message_idx] + example_messages + prompt_messages[last_user_message_idx:]
        )

        return prompt_messages

    def _validate_result(self, data: ParameterExtractorNodeData, result: dict):
        if len(data.parameters) != len(result):
            raise InvalidNumberOfParametersError("Invalid number of parameters")

        for parameter in data.parameters:
            if parameter.required and parameter.name not in result:
                raise RequiredParameterMissingError(f"Parameter {parameter.name} is required")

            param_value = result.get(parameter.name)
            if not parameter.type.is_valid(param_value, array_validation=ArrayValidation.ALL):
                inferred_type = SegmentType.infer_segment_type(param_value)
                raise InvalidValueTypeError(
                    parameter_name=parameter.name,
                    expected_type=parameter.type,
                    actual_type=inferred_type,
                    value=param_value,
                )
            if parameter.type == SegmentType.STRING and parameter.options:
                if param_value not in parameter.options:
                    raise InvalidSelectValueError(f"Invalid `select` value for parameter {parameter.name}")
        return result

    @staticmethod
    def _transform_number(value: int | float | str | bool) -> int | float | None:
        """
        Attempts to transform the input into an integer or float.

        Returns:
            int or float: The transformed number if the conversion is successful.
            None: If the transformation fails.

        Note:
            Boolean values `True` and `False` are converted to integers `1` and `0`, respectively.
            This behavior ensures compatibility with existing workflows that may use boolean types as integers.
        """
        if isinstance(value, bool):
            return int(value)
        elif isinstance(value, (int, float)):
            return value
        elif isinstance(value, str):
            if "." in value:
                try:
                    return float(value)
                except ValueError:
                    return None
            else:
                try:
                    return int(value)
                except ValueError:
                    return None
        else:
            return None

    def _transform_result(self, data: ParameterExtractorNodeData, result: dict):
        """
        Transform result into standard format.
        """
        transformed_result: dict[str, Any] = {}
        for parameter in data.parameters:
            if parameter.name in result:
                param_value = result[parameter.name]
                # transform value
                if parameter.type == SegmentType.NUMBER:
                    transformed = self._transform_number(param_value)
                    if transformed is not None:
                        transformed_result[parameter.name] = transformed
                elif parameter.type == SegmentType.BOOLEAN:
                    if isinstance(result[parameter.name], (bool, int)):
                        transformed_result[parameter.name] = bool(result[parameter.name])
                    # elif isinstance(result[parameter.name], str):
                    #     if result[parameter.name].lower() in ["true", "false"]:
                    #         transformed_result[parameter.name] = bool(result[parameter.name].lower() == "true")
                elif parameter.type == SegmentType.STRING:
                    if isinstance(param_value, str):
                        transformed_result[parameter.name] = param_value
                elif parameter.is_array_type():
                    if isinstance(param_value, list):
                        nested_type = parameter.element_type()
                        assert nested_type is not None
                        segment_value = build_segment_with_type(segment_type=SegmentType(parameter.type), value=[])
                        transformed_result[parameter.name] = segment_value
                        for item in param_value:
                            if nested_type == SegmentType.NUMBER:
                                transformed = self._transform_number(item)
                                if transformed is not None:
                                    segment_value.value.append(transformed)
                            elif nested_type == SegmentType.STRING:
                                if isinstance(item, str):
                                    segment_value.value.append(item)
                            elif nested_type == SegmentType.OBJECT:
                                if isinstance(item, dict):
                                    segment_value.value.append(item)
                            elif nested_type == SegmentType.BOOLEAN:
                                if isinstance(item, bool):
                                    segment_value.value.append(item)

            if parameter.name not in transformed_result:
                if parameter.type.is_array_type():
                    transformed_result[parameter.name] = build_segment_with_type(
                        segment_type=SegmentType(parameter.type), value=[]
                    )
                elif parameter.type in (SegmentType.STRING, SegmentType.SECRET):
                    transformed_result[parameter.name] = ""
                elif parameter.type == SegmentType.NUMBER:
                    transformed_result[parameter.name] = 0
                elif parameter.type == SegmentType.BOOLEAN:
                    transformed_result[parameter.name] = False
                else:
                    raise AssertionError("this statement should be unreachable.")

        return transformed_result

    def _extract_complete_json_response(self, result: str) -> dict | None:
        """
        Extract complete json response.
        """

        # extract json from the text
        for idx in range(len(result)):
            if result[idx] == "{" or result[idx] == "[":
                json_str = extract_json(result[idx:])
                if json_str:
                    with contextlib.suppress(Exception):
                        return cast(dict, json.loads(json_str))
        logger.info("extra error: %s", result)
        return None

    def _extract_json_from_tool_call(self, tool_call: AssistantPromptMessage.ToolCall) -> dict | None:
        """
        Extract json from tool call.
        """
        if not tool_call or not tool_call.function.arguments:
            return None

        result = tool_call.function.arguments
        # extract json from the arguments
        for idx in range(len(result)):
            if result[idx] == "{" or result[idx] == "[":
                json_str = extract_json(result[idx:])
                if json_str:
                    with contextlib.suppress(Exception):
                        return cast(dict, json.loads(json_str))

        logger.info("extra error: %s", result)
        return None

    def _generate_default_result(self, data: ParameterExtractorNodeData):
        """
        Generate default result.
        """
        result: dict[str, Any] = {}
        for parameter in data.parameters:
            if parameter.type == "number":
                result[parameter.name] = 0
            elif parameter.type == "boolean":
                result[parameter.name] = False
            elif parameter.type in {"string", "select"}:
                result[parameter.name] = ""

        return result

    def _get_function_calling_prompt_template(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        memory: TokenBufferMemory | None,
        max_token_limit: int = 2000,
    ) -> list[ChatModelMessage]:
        model_mode = ModelMode(node_data.model.mode)
        input_text = query
        memory_str = ""
        instruction = variable_pool.convert_template(node_data.instruction or "").text

        if memory and node_data.memory and node_data.memory.window:
            memory_str = memory.get_history_prompt_text(
                max_token_limit=max_token_limit, message_limit=node_data.memory.window.size
            )
        if model_mode == ModelMode.CHAT:
            system_prompt_messages = ChatModelMessage(
                role=PromptMessageRole.SYSTEM,
                text=FUNCTION_CALLING_EXTRACTOR_SYSTEM_PROMPT.format(histories=memory_str, instruction=instruction),
            )
            user_prompt_message = ChatModelMessage(role=PromptMessageRole.USER, text=input_text)
            return [system_prompt_messages, user_prompt_message]
        else:
            raise InvalidModelModeError(f"Model mode {model_mode} not support.")

    def _get_prompt_engineering_prompt_template(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        memory: TokenBufferMemory | None,
        max_token_limit: int = 2000,
    ):
        model_mode = ModelMode(node_data.model.mode)
        input_text = query
        memory_str = ""
        instruction = variable_pool.convert_template(node_data.instruction or "").text

        if memory and node_data.memory and node_data.memory.window:
            memory_str = memory.get_history_prompt_text(
                max_token_limit=max_token_limit, message_limit=node_data.memory.window.size
            )
        if model_mode == ModelMode.CHAT:
            system_prompt_messages = ChatModelMessage(
                role=PromptMessageRole.SYSTEM,
                text=CHAT_GENERATE_JSON_PROMPT.format(histories=memory_str, instructions=instruction),
            )
            user_prompt_message = ChatModelMessage(role=PromptMessageRole.USER, text=input_text)
            return [system_prompt_messages, user_prompt_message]
        elif model_mode == ModelMode.COMPLETION:
            return CompletionModelPromptTemplate(
                text=COMPLETION_GENERATE_JSON_PROMPT.format(
                    histories=memory_str, text=input_text, instruction=instruction
                )
                .replace("{γγγ", "")
                .replace("}γγγ", "")
            )
        else:
            raise InvalidModelModeError(f"Model mode {model_mode} not support.")

    def _calculate_rest_token(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_config: ModelConfigWithCredentialsEntity,
        context: str | None,
    ) -> int:
        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)

        model_instance, model_config = self._fetch_model_config(node_data.model)
        if not isinstance(model_instance.model_type_instance, LargeLanguageModel):
            raise InvalidModelTypeError("Model is not a Large Language Model")

        llm_model = model_instance.model_type_instance
        model_schema = llm_model.get_model_schema(model_config.model, model_config.credentials)
        if not model_schema:
            raise ModelSchemaNotFoundError("Model schema not found")

        if set(model_schema.features or []) & {ModelFeature.MULTI_TOOL_CALL, ModelFeature.MULTI_TOOL_CALL}:
            prompt_template = self._get_function_calling_prompt_template(node_data, query, variable_pool, None, 2000)
        else:
            prompt_template = self._get_prompt_engineering_prompt_template(node_data, query, variable_pool, None, 2000)

        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query="",
            files=[],
            context=context,
            memory_config=node_data.memory,
            memory=None,
            model_config=model_config,
        )
        rest_tokens = 2000

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)
        if model_context_tokens:
            model_type_instance = model_config.provider_model_bundle.model_type_instance
            model_type_instance = cast(LargeLanguageModel, model_type_instance)

            curr_message_tokens = (
                model_type_instance.get_num_tokens(model_config.model, model_config.credentials, prompt_messages) + 1000
            )  # add 1000 to ensure tool call messages

            max_tokens = 0
            for parameter_rule in model_config.model_schema.parameter_rules:
                if parameter_rule.name == "max_tokens" or (
                    parameter_rule.use_template and parameter_rule.use_template == "max_tokens"
                ):
                    max_tokens = (
                        model_config.parameters.get(parameter_rule.name)
                        or model_config.parameters.get(parameter_rule.use_template or "")
                    ) or 0

            rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
            rest_tokens = max(rest_tokens, 0)

        return rest_tokens

    def _fetch_model_config(
        self, node_data_model: ModelConfig
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        """
        Fetch model config.
        """
        if not self._model_instance or not self._model_config:
            self._model_instance, self._model_config = llm_utils.fetch_model_config(
                tenant_id=self.tenant_id, node_data_model=node_data_model
            )

        return self._model_instance, self._model_config

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = ParameterExtractorNodeData.model_validate(node_data)

        variable_mapping: dict[str, Sequence[str]] = {"query": typed_node_data.query}

        if typed_node_data.instruction:
            selectors = variable_template_parser.extract_selectors_from_template(typed_node_data.instruction)
            for selector in selectors:
                variable_mapping[selector.variable] = selector.value_selector

        variable_mapping = {node_id + "." + key: value for key, value in variable_mapping.items()}

        return variable_mapping
