from __future__ import annotations

import contextlib
import json
import logging
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, assert_never, overload, override

from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.file.models import File
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    PromptMessageTool,
    ToolPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import (
    ModelFeature,
    ModelPropertyKey,
    ModelType,
)
from graphon.model_runtime.memory.prompt_message_memory import PromptMessageMemory
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base import variable_template_parser
from graphon.nodes.base.node import Node
from graphon.nodes.llm import llm_utils
from graphon.nodes.llm.entities import (
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
)
from graphon.nodes.llm.runtime_protocols import (
    LLMProtocol,
    PromptMessageSerializerProtocol,
)
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.runtime.variable_pool import VariablePool
from graphon.variables.factory import build_segment_with_type
from graphon.variables.template_resolution import convert_template
from graphon.variables.types import ArrayValidation, SegmentType

from .entities import ParameterConfig, ParameterExtractorNodeData
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

_JSON_OPEN_TOKENS = frozenset(("{", "["))
_JSON_CLOSE_TOKENS = frozenset(("}", "]"))
_EMPTY_STRING_PARAMETER_TYPES = frozenset(("string", "select"))
_TRANSFORM_RESULT_UNSET = object()
_VALUE_TRANSFORMER_NAMES: dict[SegmentType, str] = {
    SegmentType.NUMBER: "_transform_number_value",
    SegmentType.BOOLEAN: "_transform_boolean_value",
    SegmentType.STRING: "_transform_string_value",
}
_ARRAY_ITEM_TRANSFORMER_NAMES: dict[SegmentType, str] = {
    SegmentType.NUMBER: "_transform_number_value",
    SegmentType.STRING: "_transform_string_value",
    SegmentType.OBJECT: "_transform_object_value",
    SegmentType.BOOLEAN: "_transform_boolean_item_value",
}


def extract_json(text: str) -> str | None:
    """From a given JSON started from '{' or '[' extract the complete JSON object."""
    stack = []
    for i, c in enumerate(text):
        if c in _JSON_OPEN_TOKENS:
            stack.append(c)
        elif c in _JSON_CLOSE_TOKENS:
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


@dataclass(frozen=True)
class _ParameterExtractorRunContext:
    model_instance: LLMProtocol
    prompt_messages: list[PromptMessage]
    prompt_message_tools: list[PromptMessageTool]
    inputs: dict[str, Any]
    process_data: dict[str, Any]


@dataclass(frozen=True)
class _ParameterExtractorNodeDependencies:
    """Runtime collaborators used directly by ParameterExtractorNode."""

    model_instance: LLMProtocol
    prompt_message_serializer: PromptMessageSerializerProtocol
    memory: PromptMessageMemory | None = None


class ParameterExtractorNode(Node[ParameterExtractorNodeData]):
    """Parameter Extractor Node."""

    node_type = BuiltinNodeTypes.PARAMETER_EXTRACTOR

    _model_instance: LLMProtocol
    _prompt_message_serializer: PromptMessageSerializerProtocol
    _memory: PromptMessageMemory | None

    @overload
    def __init__(
        self,
        node_id: str,
        data: ParameterExtractorNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        dependencies: _ParameterExtractorNodeDependencies,
        credentials_provider: object | None = None,
        model_factory: object | None = None,
        model_instance: None = None,
        memory: None = None,
        prompt_message_serializer: None = None,
    ) -> None: ...

    @overload
    def __init__(
        self,
        node_id: str,
        data: ParameterExtractorNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        dependencies: None = None,
        credentials_provider: object | None = None,
        model_factory: object | None = None,
        model_instance: LLMProtocol,
        memory: PromptMessageMemory | None = None,
        prompt_message_serializer: PromptMessageSerializerProtocol,
    ) -> None: ...

    @override
    def __init__(
        self,
        node_id: str,
        data: ParameterExtractorNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        dependencies: _ParameterExtractorNodeDependencies | None = None,
        credentials_provider: object | None = None,
        model_factory: object | None = None,
        model_instance: LLMProtocol | None = None,
        memory: PromptMessageMemory | None = None,
        prompt_message_serializer: PromptMessageSerializerProtocol | None = None,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        resolved_dependencies = self._resolve_dependencies(
            dependencies=dependencies,
            model_instance=model_instance,
            memory=memory,
            prompt_message_serializer=prompt_message_serializer,
        )
        _ = credentials_provider, model_factory
        self._model_instance = resolved_dependencies.model_instance
        self._prompt_message_serializer = (
            resolved_dependencies.prompt_message_serializer
        )
        self._memory = resolved_dependencies.memory

    @staticmethod
    def _resolve_dependencies(
        *,
        dependencies: _ParameterExtractorNodeDependencies | None,
        model_instance: LLMProtocol | None,
        memory: PromptMessageMemory | None,
        prompt_message_serializer: PromptMessageSerializerProtocol | None,
    ) -> _ParameterExtractorNodeDependencies:
        if dependencies is not None:
            if (
                model_instance is not None
                or memory is not None
                or prompt_message_serializer is not None
            ):
                msg = (
                    "Pass either dependencies=... or the legacy "
                    "model_instance=/memory=/"
                    "prompt_message_serializer= keywords, not both."
                )
                raise TypeError(msg)
            return dependencies

        if model_instance is None or prompt_message_serializer is None:
            missing_dependencies: list[str] = []
            if model_instance is None:
                missing_dependencies.append("model_instance")
            if prompt_message_serializer is None:
                missing_dependencies.append("prompt_message_serializer")
            missing = ", ".join(missing_dependencies)
            msg = (
                "ParameterExtractorNode requires either dependencies=... or "
                f"legacy {missing} keyword arguments."
            )
            raise TypeError(msg)

        return _ParameterExtractorNodeDependencies(
            model_instance=model_instance,
            prompt_message_serializer=prompt_message_serializer,
            memory=memory,
        )

    @classmethod
    @override
    def get_default_config(
        cls,
        filters: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        _ = filters
        return {
            "model": {
                "prompt_templates": {
                    "completion_model": {
                        "conversation_histories_role": {
                            "user_prefix": "Human",
                            "assistant_prefix": "Assistant",
                        },
                        "stop": ["Human:"],
                    },
                },
            },
        }

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        """Run the node."""
        run_context = self._prepare_run_context()

        try:
            text, usage, tool_call = self._invoke(
                model_instance=run_context.model_instance,
                prompt_messages=run_context.prompt_messages,
                tools=run_context.prompt_message_tools,
                stop=run_context.model_instance.stop,
            )
            run_context.process_data["usage"] = jsonable_encoder(usage)
            run_context.process_data["tool_call"] = jsonable_encoder(tool_call)
            run_context.process_data["llm_text"] = text
        except ParameterExtractorNodeError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=run_context.inputs,
                process_data=run_context.process_data,
                outputs={"__is_success": 0, "__reason": str(e)},
                error=str(e),
                metadata={},
            )
        except Exception as e:
            logger.exception("Failed to invoke parameter extractor model")
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=run_context.inputs,
                process_data=run_context.process_data,
                outputs={
                    "__is_success": 0,
                    "__reason": "Failed to invoke model",
                    "__error": str(e),
                },
                error=str(e),
                metadata={},
            )

        error = None

        if tool_call:
            result = self._extract_json_from_tool_call(tool_call)
        else:
            result = self._extract_complete_json_response(text)
            if not result:
                result = self._generate_default_result(self.node_data)
                error = (
                    "Failed to extract result from function call or text response, "
                    "using empty result."
                )

        try:
            result = self._validate_result(data=self.node_data, result=result or {})
        except ParameterExtractorNodeError as e:
            error = str(e)

        # transform result into standard format
        result = self._transform_result(data=self.node_data, result=result or {})

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=run_context.inputs,
            process_data=run_context.process_data,
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

    def _prepare_run_context(self) -> _ParameterExtractorRunContext:
        node_data = self.node_data
        variable_pool = self.runtime_state.variable_pool
        variable = variable_pool.get(node_data.query)
        query = variable.text if variable else ""
        files = (
            llm_utils.fetch_files(
                variable_pool=variable_pool,
                selector=node_data.vision.configs.variable_selector,
            )
            if node_data.vision.enabled
            else []
        )
        model_instance = self._prepare_model_instance(variable_pool=variable_pool)
        model_schema = self._fetch_llm_model_schema(model_instance=model_instance)
        prompt_messages, prompt_message_tools = self._build_run_prompt(
            query=query,
            variable_pool=variable_pool,
            model_instance=model_instance,
            files=files,
            model_schema_features=model_schema.features or [],
        )
        inputs = {
            "query": query,
            "files": [f.to_dict() for f in files],
            "parameters": jsonable_encoder(node_data.parameters),
            "instruction": jsonable_encoder(node_data.instruction),
            **llm_utils.build_model_identity_inputs(model_instance=model_instance),
        }
        process_data = {
            "model_mode": node_data.model.mode,
            "prompts": self._prompt_message_serializer.serialize(
                model_mode=node_data.model.mode,
                prompt_messages=prompt_messages,
            ),
            "usage": None,
            "function": {}
            if not prompt_message_tools
            else jsonable_encoder(prompt_message_tools[0]),
            "tool_call": None,
            "model_provider": model_instance.provider,
            "model_name": model_instance.model_name,
        }
        return _ParameterExtractorRunContext(
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            prompt_message_tools=prompt_message_tools,
            inputs=inputs,
            process_data=process_data,
        )

    def _prepare_model_instance(
        self,
        *,
        variable_pool: VariablePool,
    ) -> LLMProtocol:
        model_instance = self._model_instance
        model_instance.parameters = llm_utils.resolve_completion_params_variables(
            model_instance.parameters,
            variable_pool,
        )
        return model_instance

    @staticmethod
    def _fetch_llm_model_schema(
        *,
        model_instance: LLMProtocol,
    ) -> Any:
        try:
            model_schema = llm_utils.fetch_model_schema(model_instance=model_instance)
        except ValueError as exc:
            msg = "Model schema not found"
            raise ModelSchemaNotFoundError(msg) from exc
        if model_schema.model_type != ModelType.LLM:
            msg = "Model is not a Large Language Model"
            raise InvalidModelTypeError(msg)
        return model_schema

    def _build_run_prompt(
        self,
        *,
        query: str,
        variable_pool: VariablePool,
        model_instance: LLMProtocol,
        files: Sequence[File],
        model_schema_features: Sequence[ModelFeature],
    ) -> tuple[list[PromptMessage], list[PromptMessageTool]]:
        if (
            set(model_schema_features)
            & frozenset((ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL))
            and self.node_data.reasoning_mode == "function_call"
        ):
            return self._generate_function_call_prompt(
                node_data=self.node_data,
                query=query,
                variable_pool=variable_pool,
                model_instance=model_instance,
                memory=self._memory,
                files=files,
                vision_detail=self.node_data.vision.configs.detail,
            )
        return (
            self._generate_prompt_engineering_prompt(
                data=self.node_data,
                query=query,
                variable_pool=variable_pool,
                model_instance=model_instance,
                memory=self._memory,
                files=files,
                vision_detail=self.node_data.vision.configs.detail,
            ),
            [],
        )

    def _invoke(
        self,
        model_instance: LLMProtocol,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool],
        stop: Sequence[str] | None,
    ) -> tuple[str, LLMUsage, AssistantPromptMessage.ToolCall | None]:
        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=dict(model_instance.parameters),
            tools=tools or None,
            stop=stop,
            stream=False,
        )

        # handle invoke result

        text = invoke_result.message.get_text_content()
        if not isinstance(text, str):
            msg = f"Invalid text content type: {type(text)}. Expected str."
            raise InvalidTextContentTypeError(msg)

        usage = invoke_result.usage
        tool_call = (
            invoke_result.message.tool_calls[0]
            if invoke_result.message.tool_calls
            else None
        )

        return text, usage, tool_call

    def _generate_function_call_prompt(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_instance: LLMProtocol,
        memory: PromptMessageMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> tuple[list[PromptMessage], list[PromptMessageTool]]:
        """Generate function call prompt."""
        query = FUNCTION_CALLING_EXTRACTOR_USER_TEMPLATE.format(
            content=query,
            structure=json.dumps(node_data.get_parameter_json_schema()),
        )

        rest_token = self._calculate_rest_token(
            node_data=node_data,
            query=query,
            variable_pool=variable_pool,
            model_instance=model_instance,
            context="",
        )
        prompt_template = self._get_function_calling_prompt_template(
            node_data,
            query,
            variable_pool,
            memory,
            rest_token,
        )
        prompt_messages = self._compile_prompt_messages(
            model_instance=model_instance,
            prompt_template=prompt_template,
            files=files,
            vision_enabled=node_data.vision.enabled,
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
            tool_call_id = uuid.uuid4().hex
            example_messages.extend([
                UserPromptMessage(content=example["user"]["query"]),
                AssistantPromptMessage(
                    content=example["assistant"]["text"],
                    tool_calls=[
                        AssistantPromptMessage.ToolCall(
                            id=tool_call_id,
                            type="function",
                            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                name=example["assistant"]["function_call"]["name"],
                                arguments=json.dumps(
                                    example["assistant"]["function_call"]["parameters"],
                                ),
                            ),
                        ),
                    ],
                ),
                ToolPromptMessage(
                    content=(
                        "Great! You have called the function with the correct "
                        "parameters."
                    ),
                    tool_call_id=tool_call_id,
                ),
                AssistantPromptMessage(
                    content="I have extracted the parameters, let's move on.",
                ),
            ])

        prompt_messages = (
            prompt_messages[:last_user_message_idx]
            + example_messages
            + prompt_messages[last_user_message_idx:]
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
        model_instance: LLMProtocol,
        memory: PromptMessageMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> list[PromptMessage]:
        """Generate prompt engineering prompt."""
        if data.model.mode == LLMMode.COMPLETION:
            return self._generate_prompt_engineering_completion_prompt(
                node_data=data,
                query=query,
                variable_pool=variable_pool,
                model_instance=model_instance,
                memory=memory,
                files=files,
                vision_detail=vision_detail,
            )
        if data.model.mode == LLMMode.CHAT:
            return self._generate_prompt_engineering_chat_prompt(
                node_data=data,
                query=query,
                variable_pool=variable_pool,
                model_instance=model_instance,
                memory=memory,
                files=files,
                vision_detail=vision_detail,
            )
        msg = f"Invalid model mode: {data.model.mode}"
        raise InvalidModelModeError(msg)

    def _generate_prompt_engineering_completion_prompt(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_instance: LLMProtocol,
        memory: PromptMessageMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> list[PromptMessage]:
        """Generate completion prompt."""
        rest_token = self._calculate_rest_token(
            node_data=node_data,
            query=query,
            variable_pool=variable_pool,
            model_instance=model_instance,
            context="",
        )
        prompt_template = self._get_prompt_engineering_prompt_template(
            node_data=node_data,
            query=query,
            variable_pool=variable_pool,
            memory=memory,
            max_token_limit=rest_token,
        )
        return self._compile_prompt_messages(
            model_instance=model_instance,
            prompt_template=prompt_template,
            files=files,
            vision_enabled=node_data.vision.enabled,
            image_detail_config=vision_detail,
        )

    def _generate_prompt_engineering_chat_prompt(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_instance: LLMProtocol,
        memory: PromptMessageMemory | None,
        files: Sequence[File],
        vision_detail: ImagePromptMessageContent.DETAIL | None = None,
    ) -> list[PromptMessage]:
        """Generate chat prompt."""
        rest_token = self._calculate_rest_token(
            node_data=node_data,
            query=query,
            variable_pool=variable_pool,
            model_instance=model_instance,
            context="",
        )
        prompt_template = self._get_prompt_engineering_prompt_template(
            node_data=node_data,
            query=CHAT_GENERATE_JSON_USER_MESSAGE_TEMPLATE.format(
                structure=json.dumps(node_data.get_parameter_json_schema()),
                text=query,
            ),
            variable_pool=variable_pool,
            memory=memory,
            max_token_limit=rest_token,
        )

        prompt_messages = self._compile_prompt_messages(
            model_instance=model_instance,
            prompt_template=prompt_template,
            files=files,
            vision_enabled=node_data.vision.enabled,
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
            example_messages.extend([
                UserPromptMessage(
                    content=CHAT_GENERATE_JSON_USER_MESSAGE_TEMPLATE.format(
                        structure=json.dumps(example["user"]["json"]),
                        text=example["user"]["query"],
                    ),
                ),
                AssistantPromptMessage(
                    content=json.dumps(example["assistant"]["json"]),
                ),
            ])

        return (
            prompt_messages[:last_user_message_idx]
            + example_messages
            + prompt_messages[last_user_message_idx:]
        )

    def _validate_result(
        self,
        data: ParameterExtractorNodeData,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        if len(data.parameters) != len(result):
            msg = "Invalid number of parameters"
            raise InvalidNumberOfParametersError(msg)

        for parameter in data.parameters:
            if parameter.required and parameter.name not in result:
                msg = f"Parameter {parameter.name} is required"
                raise RequiredParameterMissingError(msg)

            param_value = result.get(parameter.name)
            if not parameter.type.is_valid(
                param_value,
                array_validation=ArrayValidation.ALL,
            ):
                inferred_type = SegmentType.infer_segment_type(param_value)
                raise InvalidValueTypeError(
                    parameter_name=parameter.name,
                    expected_type=parameter.type,
                    actual_type=inferred_type,
                    value=param_value,
                )
            if (
                parameter.type == SegmentType.STRING
                and parameter.options
                and param_value not in parameter.options
            ):
                msg = f"Invalid `select` value for parameter {parameter.name}"
                raise InvalidSelectValueError(msg)
        return result

    @staticmethod
    def _transform_number(value: float | str | bool) -> int | float | None:
        """Attempts to transform the input into an integer or float.

        Returns:
            int or float: The transformed number if the conversion is successful.
            None: If the transformation fails.

        Note:
            Boolean values `True` and `False` are converted to integers `1` and
            `0`, respectively.
            This behavior ensures compatibility with existing workflows that may
            use boolean types as integers.

        """
        transformed_value: int | float | None = None
        match value:
            case bool():
                transformed_value = int(value)
            case int() | float():
                transformed_value = value
            case str():
                transform = float if "." in value else int
                try:
                    transformed_value = transform(value)
                except ValueError:
                    transformed_value = None
        return transformed_value

    def _transform_result(
        self,
        data: ParameterExtractorNodeData,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        """Transform result into standard format."""
        transformed_result: dict[str, Any] = {}
        for parameter in data.parameters:
            transformed_value = self._transform_parameter_value(
                parameter=parameter,
                param_value=result.get(parameter.name, _TRANSFORM_RESULT_UNSET),
            )
            if transformed_value is _TRANSFORM_RESULT_UNSET:
                transformed_result[parameter.name] = (
                    self._build_default_parameter_value(parameter.type)
                )
                continue
            transformed_result[parameter.name] = transformed_value

        return transformed_result

    def transform_result(
        self,
        data: ParameterExtractorNodeData,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        """Transform model output into the node's normalized result shape."""
        return self._transform_result(data, result)

    def _transform_parameter_value(
        self,
        *,
        parameter: ParameterConfig,
        param_value: Any,
    ) -> Any:
        if param_value is _TRANSFORM_RESULT_UNSET:
            return _TRANSFORM_RESULT_UNSET
        if parameter.type.is_array_type():
            return self._transform_array_parameter_value(
                parameter_type=parameter.type,
                element_type=parameter.element_type(),
                param_value=param_value,
            )

        handler_name = _VALUE_TRANSFORMER_NAMES.get(parameter.type)
        if handler_name is None:
            return _TRANSFORM_RESULT_UNSET
        return getattr(self, handler_name)(param_value)

    def _transform_array_parameter_value(
        self,
        *,
        parameter_type: SegmentType,
        element_type: SegmentType,
        param_value: Any,
    ) -> Any:
        if not isinstance(param_value, list):
            return _TRANSFORM_RESULT_UNSET

        segment_value = build_segment_with_type(segment_type=parameter_type, value=[])
        handler_name = _ARRAY_ITEM_TRANSFORMER_NAMES.get(element_type)
        if handler_name is None:
            return segment_value

        for item in param_value:
            transformed_item = getattr(self, handler_name)(item)
            if transformed_item is not _TRANSFORM_RESULT_UNSET:
                segment_value.value.append(transformed_item)
        return segment_value

    def _transform_number_value(self, value: Any) -> Any:
        transformed = self._transform_number(value)
        if transformed is None:
            return _TRANSFORM_RESULT_UNSET
        return transformed

    @staticmethod
    def _transform_boolean_value(value: Any) -> Any:
        if isinstance(value, (bool, int)):
            return bool(value)
        return _TRANSFORM_RESULT_UNSET

    @staticmethod
    def _transform_boolean_item_value(value: Any) -> Any:
        if isinstance(value, bool):
            return value
        return _TRANSFORM_RESULT_UNSET

    @staticmethod
    def _transform_string_value(value: Any) -> Any:
        if isinstance(value, str):
            return value
        return _TRANSFORM_RESULT_UNSET

    @staticmethod
    def _transform_object_value(value: Any) -> Any:
        if isinstance(value, dict):
            return value
        return _TRANSFORM_RESULT_UNSET

    @staticmethod
    def _build_default_parameter_value(parameter_type: SegmentType) -> Any:
        match parameter_type:
            case (
                SegmentType.ARRAY_ANY
                | SegmentType.ARRAY_STRING
                | SegmentType.ARRAY_NUMBER
                | SegmentType.ARRAY_OBJECT
                | SegmentType.ARRAY_FILE
                | SegmentType.ARRAY_BOOLEAN
            ):
                return build_segment_with_type(segment_type=parameter_type, value=[])
            case SegmentType.STRING | SegmentType.SECRET:
                return ""
            case SegmentType.NUMBER:
                return 0
            case SegmentType.BOOLEAN:
                return False
            case (
                SegmentType.INTEGER
                | SegmentType.FLOAT
                | SegmentType.OBJECT
                | SegmentType.FILE
                | SegmentType.NONE
                | SegmentType.GROUP
            ):
                msg = "this statement should be unreachable."
                raise AssertionError(msg)
            case _:
                assert_never(parameter_type)

    def _extract_complete_json_response(self, result: str) -> dict | None:
        """Extract complete json response."""
        # extract json from the text
        for idx in range(len(result)):
            if result[idx] in _JSON_OPEN_TOKENS:
                json_str = extract_json(result[idx:])
                if json_str:
                    with contextlib.suppress(Exception):
                        parsed = json.loads(json_str)
                        if isinstance(parsed, dict):
                            return parsed
        logger.info("extra error: %s", result)
        return None

    def _extract_json_from_tool_call(
        self,
        tool_call: AssistantPromptMessage.ToolCall,
    ) -> dict | None:
        """Extract json from tool call."""
        if not tool_call or not tool_call.function.arguments:
            return None

        result = tool_call.function.arguments
        # extract json from the arguments
        for idx in range(len(result)):
            if result[idx] in _JSON_OPEN_TOKENS:
                json_str = extract_json(result[idx:])
                if json_str:
                    with contextlib.suppress(Exception):
                        parsed = json.loads(json_str)
                        if isinstance(parsed, dict):
                            return parsed

        logger.info("extra error: %s", result)
        return None

    def _generate_default_result(
        self,
        data: ParameterExtractorNodeData,
    ) -> dict[str, Any]:
        """Generate default result."""
        result: dict[str, Any] = {}
        for parameter in data.parameters:
            if parameter.type == "number":
                result[parameter.name] = 0
            elif parameter.type == "boolean":
                result[parameter.name] = False
            elif parameter.type in _EMPTY_STRING_PARAMETER_TYPES:
                result[parameter.name] = ""

        return result

    def _get_function_calling_prompt_template(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        memory: PromptMessageMemory | None,
        max_token_limit: int = 2000,
    ) -> list[LLMNodeChatModelMessage]:
        input_text = query
        memory_str = ""
        instruction = convert_template(
            variable_pool,
            node_data.instruction or "",
        ).text

        if memory and node_data.memory and node_data.memory.window:
            memory_str = llm_utils.fetch_memory_text(
                memory=memory,
                max_token_limit=max_token_limit,
                message_limit=node_data.memory.window.size,
            )
        if node_data.model.mode == LLMMode.CHAT:
            system_prompt_messages = LLMNodeChatModelMessage(
                role=PromptMessageRole.SYSTEM,
                text=FUNCTION_CALLING_EXTRACTOR_SYSTEM_PROMPT.format(
                    histories=memory_str,
                    instruction=instruction,
                ),
            )
            user_prompt_message = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER,
                text=input_text,
            )
            return [system_prompt_messages, user_prompt_message]
        msg = f"Model mode {node_data.model.mode} not support."
        raise InvalidModelModeError(msg)

    def get_function_calling_prompt_template(
        self,
        *,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        memory: PromptMessageMemory | None,
        max_token_limit: int = 2000,
    ) -> list[LLMNodeChatModelMessage]:
        """Build the function-calling prompt template for the current request."""
        return self._get_function_calling_prompt_template(
            node_data=node_data,
            query=query,
            variable_pool=variable_pool,
            memory=memory,
            max_token_limit=max_token_limit,
        )

    def _get_prompt_engineering_prompt_template(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        memory: PromptMessageMemory | None,
        max_token_limit: int = 2000,
    ) -> list[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate:
        input_text = query
        memory_str = ""
        instruction = convert_template(
            variable_pool,
            node_data.instruction or "",
        ).text

        if memory and node_data.memory and node_data.memory.window:
            memory_str = llm_utils.fetch_memory_text(
                memory=memory,
                max_token_limit=max_token_limit,
                message_limit=node_data.memory.window.size,
            )
        if node_data.model.mode == LLMMode.CHAT:
            system_prompt_messages = LLMNodeChatModelMessage(
                role=PromptMessageRole.SYSTEM,
                text=CHAT_GENERATE_JSON_PROMPT.format(
                    histories=memory_str,
                    instruction=instruction,
                ),
            )
            user_prompt_message = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER,
                text=input_text,
            )
            return [system_prompt_messages, user_prompt_message]
        if node_data.model.mode == LLMMode.COMPLETION:
            return LLMNodeCompletionModelPromptTemplate(
                text=COMPLETION_GENERATE_JSON_PROMPT
                .format(histories=memory_str, text=input_text, instruction=instruction)
                .replace("{γγγ", "")  # ruff:ignore[ambiguous-unicode-character-string]
                .replace("}γγγ", "")  # ruff:ignore[ambiguous-unicode-character-string]
                .replace(
                    "{ structure }",
                    json.dumps(node_data.get_parameter_json_schema()),
                ),
            )
        msg = f"Model mode {node_data.model.mode} not support."
        raise InvalidModelModeError(msg)

    def _calculate_rest_token(
        self,
        node_data: ParameterExtractorNodeData,
        query: str,
        variable_pool: VariablePool,
        model_instance: LLMProtocol,
        context: str | None,
    ) -> int:
        try:
            model_schema = llm_utils.fetch_model_schema(model_instance=model_instance)
        except ValueError as exc:
            msg = "Model schema not found"
            raise ModelSchemaNotFoundError(msg) from exc

        prompt_template: (
            list[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate
        )
        if set(model_schema.features or []) & frozenset((
            ModelFeature.TOOL_CALL,
            ModelFeature.MULTI_TOOL_CALL,
        )):
            prompt_template = self._get_function_calling_prompt_template(
                node_data,
                query,
                variable_pool,
                None,
                2000,
            )
        else:
            prompt_template = self._get_prompt_engineering_prompt_template(
                node_data,
                query,
                variable_pool,
                None,
                2000,
            )

        prompt_messages = self._compile_prompt_messages(
            model_instance=model_instance,
            prompt_template=prompt_template,
            files=[],
            vision_enabled=False,
            context=context,
        )
        rest_tokens = 2000
        model_context_tokens = model_schema.model_properties.get(
            ModelPropertyKey.CONTEXT_SIZE,
        )
        if model_context_tokens:
            curr_message_tokens = (
                model_instance.get_llm_num_tokens(prompt_messages) + 1000
            )

            max_tokens = 0
            for parameter_rule in model_schema.parameter_rules:
                if parameter_rule.name == "max_tokens" or (
                    parameter_rule.use_template
                    and parameter_rule.use_template == "max_tokens"
                ):
                    max_tokens = (
                        model_instance.parameters.get(parameter_rule.name)
                        or model_instance.parameters.get(
                            parameter_rule.use_template or "",
                        )
                    ) or 0

            rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
            rest_tokens = max(rest_tokens, 0)

        return rest_tokens

    def _compile_prompt_messages(
        self,
        *,
        model_instance: LLMProtocol,
        prompt_template: Sequence[LLMNodeChatModelMessage]
        | LLMNodeCompletionModelPromptTemplate,
        files: Sequence[File],
        vision_enabled: bool,
        context: str | None = "",
        image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
    ) -> list[PromptMessage]:
        prompt_messages, _ = llm_utils.fetch_prompt_messages(
            sys_query="",
            sys_files=files,
            context=context or "",
            memory=None,
            model_instance=model_instance,
            prompt_template=prompt_template,
            stop=model_instance.stop,
            memory_config=None,
            vision_enabled=vision_enabled,
            vision_detail=image_detail_config or ImagePromptMessageContent.DETAIL.HIGH,
            variable_pool=self.runtime_state.variable_pool,
            jinja2_variables=[],
        )
        return list(prompt_messages)

    @property
    def model_instance(self) -> LLMProtocol:
        return self._model_instance

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: ParameterExtractorNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config  # Explicitly mark as unused
        variable_mapping: dict[str, Sequence[str]] = {"query": node_data.query}

        if node_data.instruction:
            selectors = variable_template_parser.extract_selectors_from_template(
                node_data.instruction,
            )
            for selector in selectors:
                variable_mapping[selector.variable] = selector.value_selector

        return {node_id + "." + key: value for key, value in variable_mapping.items()}
