from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, override

from graphon.enums import (
    BuiltinNodeTypes,
    NodeExecutionType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.file.models import File
from graphon.http import HttpClientProtocol
from graphon.model_runtime.entities.llm_entities import (
    LLMMode,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import (
    PromptMessage,
    PromptMessageRole,
)
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.memory.prompt_message_memory import PromptMessageMemory
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.node_events.base import NodeRunResult
from graphon.node_events.node import ModelInvokeCompletedEvent
from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.nodes.llm import llm_utils
from graphon.nodes.llm.entities import (
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
)
from graphon.nodes.llm.file_saver import LLMFileSaver
from graphon.nodes.llm.node import LLMNode
from graphon.nodes.llm.runtime_protocols import (
    LLMProtocol,
    PromptMessageSerializerProtocol,
)
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.template_rendering import Jinja2TemplateRenderer
from graphon.utils.json_in_md_parser import parse_and_check_json_markdown
from graphon.variables.template_resolution import convert_template

from .entities import QuestionClassifierNodeData
from .exc import InvalidModelTypeError
from .template_prompts import (
    QUESTION_CLASSIFIER_ASSISTANT_PROMPT_1,
    QUESTION_CLASSIFIER_ASSISTANT_PROMPT_2,
    QUESTION_CLASSIFIER_COMPLETION_PROMPT,
    QUESTION_CLASSIFIER_SYSTEM_PROMPT,
    QUESTION_CLASSIFIER_USER_PROMPT_1,
    QUESTION_CLASSIFIER_USER_PROMPT_2,
    QUESTION_CLASSIFIER_USER_PROMPT_3,
)


class _PassthroughPromptMessageSerializer:
    def serialize(
        self,
        *,
        model_mode: Any,
        prompt_messages: Sequence[PromptMessage],
    ) -> Any:
        _ = model_mode
        return list(prompt_messages)


@dataclass(frozen=True)
class _QuestionClassifierRunContext:
    inputs: dict[str, Any]
    model_instance: LLMProtocol
    prompt_messages: Sequence[PromptMessage]
    stop: Sequence[str] | None
    rendered_classes: list[Any]


@dataclass(frozen=True, slots=True)
class QuestionClassifierNodeDependencies:
    """Runtime collaborators required to execute a question-classifier node."""

    model_instance: LLMProtocol
    template_renderer: Jinja2TemplateRenderer
    llm_file_saver: LLMFileSaver
    memory: PromptMessageMemory | None = None
    prompt_message_serializer: PromptMessageSerializerProtocol | None = None


class QuestionClassifierNode(Node[QuestionClassifierNodeData]):
    node_type = BuiltinNodeTypes.QUESTION_CLASSIFIER
    execution_type = NodeExecutionType.BRANCH

    _file_outputs: list[File]
    _llm_file_saver: LLMFileSaver
    _prompt_message_serializer: PromptMessageSerializerProtocol
    _model_instance: LLMProtocol
    _memory: PromptMessageMemory | None
    _template_renderer: Jinja2TemplateRenderer

    @override
    def __init__(
        self,
        node_id: str,
        data: QuestionClassifierNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        dependencies: QuestionClassifierNodeDependencies | None = None,
        credentials_provider: object | None = None,
        model_factory: object | None = None,
        model_instance: LLMProtocol | None = None,
        http_client: HttpClientProtocol | None = None,
        template_renderer: Jinja2TemplateRenderer | None = None,
        memory: PromptMessageMemory | None = None,
        llm_file_saver: LLMFileSaver | None = None,
        prompt_message_serializer: PromptMessageSerializerProtocol | None = None,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        # LLM file outputs, used for MultiModal outputs.
        self._file_outputs = []

        resolved_dependencies = self._resolve_dependencies(
            dependencies=dependencies,
            model_instance=model_instance,
            template_renderer=template_renderer,
            memory=memory,
            llm_file_saver=llm_file_saver,
            prompt_message_serializer=prompt_message_serializer,
        )

        _ = credentials_provider, model_factory, http_client
        self._model_instance = resolved_dependencies.model_instance
        self._memory = resolved_dependencies.memory
        self._template_renderer = resolved_dependencies.template_renderer
        self._llm_file_saver = resolved_dependencies.llm_file_saver
        self._prompt_message_serializer = (
            resolved_dependencies.prompt_message_serializer
            or _PassthroughPromptMessageSerializer()
        )

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @staticmethod
    def _resolve_dependencies(
        *,
        dependencies: QuestionClassifierNodeDependencies | None,
        model_instance: LLMProtocol | None,
        template_renderer: Jinja2TemplateRenderer | None,
        memory: PromptMessageMemory | None,
        llm_file_saver: LLMFileSaver | None,
        prompt_message_serializer: PromptMessageSerializerProtocol | None,
    ) -> QuestionClassifierNodeDependencies:
        if dependencies is not None:
            duplicate_arguments = [
                argument_name
                for argument_name, argument_value in (
                    ("model_instance", model_instance),
                    ("template_renderer", template_renderer),
                    ("memory", memory),
                    ("llm_file_saver", llm_file_saver),
                    ("prompt_message_serializer", prompt_message_serializer),
                )
                if argument_value is not None
            ]
            if duplicate_arguments:
                duplicate_arguments_str = ", ".join(sorted(duplicate_arguments))
                msg = (
                    "QuestionClassifierNode received runtime collaborators twice. "
                    "Use either 'dependencies' or the legacy keyword arguments, "
                    f"not both: {duplicate_arguments_str}."
                )
                raise TypeError(msg)
            return dependencies

        if (
            model_instance is None
            or template_renderer is None
            or llm_file_saver is None
        ):
            missing_arguments = [
                argument_name
                for argument_name, argument_value in (
                    ("model_instance", model_instance),
                    ("template_renderer", template_renderer),
                    ("llm_file_saver", llm_file_saver),
                )
                if argument_value is None
            ]
            missing_arguments_str = ", ".join(sorted(missing_arguments))
            msg = (
                "QuestionClassifierNode requires either "
                "'dependencies' or the legacy keyword arguments: "
                f"{missing_arguments_str}."
            )
            raise TypeError(msg)

        return QuestionClassifierNodeDependencies(
            model_instance=model_instance,
            template_renderer=template_renderer,
            llm_file_saver=llm_file_saver,
            memory=memory,
            prompt_message_serializer=prompt_message_serializer,
        )

    @staticmethod
    def _default_class_label(index: int) -> str:
        return f"CLASS {index}"

    @override
    def _run(self) -> NodeRunResult:
        run_context = self._prepare_run_context()
        usage = LLMUsage.empty_usage()

        try:
            result_text, usage, finish_reason = self._invoke_classifier(
                run_context=run_context,
            )
            category_name, category_id, category_label = self._resolve_category(
                rendered_classes=run_context.rendered_classes,
                result_text=result_text,
            )
            return self._build_success_result(
                run_context=run_context,
                usage=usage,
                finish_reason=finish_reason,
                category_name=category_name,
                category_label=category_label,
                category_id=category_id,
            )
        except ValueError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=run_context.inputs,
                error=str(e),
                error_type=type(e).__name__,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                },
                llm_usage=usage,
            )

    def _prepare_run_context(self) -> _QuestionClassifierRunContext:
        node_data = self.node_data
        variable_pool = self.runtime_state.variable_pool
        variable = (
            variable_pool.get(node_data.query_variable_selector)
            if node_data.query_variable_selector
            else None
        )
        query = variable.value if variable else None
        node_data.instruction = convert_template(
            variable_pool,
            node_data.instruction or "",
        ).text
        model_instance = self._prepare_model_instance(variable_pool=variable_pool)
        files = (
            llm_utils.fetch_files(
                variable_pool=variable_pool,
                selector=node_data.vision.configs.variable_selector,
            )
            if node_data.vision.enabled
            else []
        )
        prompt_messages, stop = self._build_prompt_messages(
            query=query or "",
            model_instance=model_instance,
            files=files,
        )
        inputs = {
            "query": query,
            **llm_utils.build_model_identity_inputs(model_instance=model_instance),
        }
        rendered_classes = [
            class_.model_copy(
                update={"name": convert_template(variable_pool, class_.name).text},
            )
            for class_ in node_data.classes
        ]
        return _QuestionClassifierRunContext(
            inputs=inputs,
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            stop=stop,
            rendered_classes=rendered_classes,
        )

    def _prepare_model_instance(self, *, variable_pool: Any) -> LLMProtocol:
        model_instance = self._model_instance
        model_instance.parameters = llm_utils.resolve_completion_params_variables(
            model_instance.parameters,
            variable_pool,
        )
        return model_instance

    def _build_prompt_messages(
        self,
        *,
        query: str,
        model_instance: LLMProtocol,
        files: Sequence[Any],
    ) -> tuple[Sequence[PromptMessage], Sequence[str] | None]:
        rest_token = self._calculate_rest_token(
            node_data=self.node_data,
            query=query,
            model_instance=model_instance,
            context="",
        )
        prompt_template = self._get_prompt_template(
            node_data=self.node_data,
            query=query,
            memory=self._memory,
            max_token_limit=rest_token,
        )
        return llm_utils.fetch_prompt_messages(
            prompt_template=prompt_template,
            sys_query="",
            memory=self._memory,
            model_instance=model_instance,
            stop=model_instance.stop,
            sys_files=files,
            vision_enabled=self.node_data.vision.enabled,
            vision_detail=self.node_data.vision.configs.detail,
            variable_pool=self.runtime_state.variable_pool,
            jinja2_variables=[],
            jinja2_template_renderer=self._template_renderer,
        )

    def _invoke_classifier(
        self,
        *,
        run_context: _QuestionClassifierRunContext,
    ) -> tuple[str, LLMUsage, str | None]:
        result_text = ""
        usage = LLMUsage.empty_usage()
        finish_reason = None
        generator = LLMNode.invoke_llm(
            model_instance=run_context.model_instance,
            prompt_messages=run_context.prompt_messages,
            stop=run_context.stop,
            structured_output_enabled=False,
            structured_output=None,
            file_saver=self._llm_file_saver,
            file_outputs=self._file_outputs,
            node_id=self._node_id,
        )
        for event in generator:
            if isinstance(event, ModelInvokeCompletedEvent):
                result_text = event.text
                usage = event.usage
                finish_reason = event.finish_reason
                break
        return result_text, usage, finish_reason

    @staticmethod
    def _resolve_category(
        *,
        rendered_classes: Sequence[Any],
        result_text: str,
    ) -> tuple[str, str, str]:
        category_name = rendered_classes[0].name
        category_id = rendered_classes[0].id
        category_label = rendered_classes[
            0
        ].label or QuestionClassifierNode._default_class_label(1)
        cleaned_result_text = QuestionClassifierNode._strip_think_tags(result_text)
        result_text_json = parse_and_check_json_markdown(cleaned_result_text, [])
        if (
            "category_name" not in result_text_json
            or "category_id" not in result_text_json
        ):
            return category_name, category_id, category_label

        category_id_result = result_text_json["category_id"]
        classes_map = {
            class_.id: {
                "name": class_.name,
                "label": (
                    class_.label
                    or QuestionClassifierNode._default_class_label(index + 1)
                ),
            }
            for index, class_ in enumerate(rendered_classes)
        }
        if category_id_result in classes_map:
            category = classes_map[category_id_result]
            return category["name"], category_id_result, category["label"]
        return category_name, category_id, category_label

    @staticmethod
    def _strip_think_tags(result_text: str) -> str:
        if "<think>" not in result_text:
            return result_text
        return re.sub(
            r"<think[^>]*>[\s\S]*?</think>",
            "",
            result_text,
            flags=re.IGNORECASE,
        )

    def _build_success_result(
        self,
        *,
        run_context: _QuestionClassifierRunContext,
        usage: LLMUsage,
        finish_reason: str | None,
        category_name: str,
        category_label: str,
        category_id: str,
    ) -> NodeRunResult:
        process_data = {
            "model_mode": self.node_data.model.mode,
            "prompts": self._prompt_message_serializer.serialize(
                model_mode=self.node_data.model.mode,
                prompt_messages=run_context.prompt_messages,
            ),
            "usage": jsonable_encoder(usage),
            "finish_reason": finish_reason,
            "model_provider": run_context.model_instance.provider,
            "model_name": run_context.model_instance.model_name,
        }
        outputs = {
            "class_name": category_name,
            "class_label": category_label,
            "class_id": category_id,
            "usage": jsonable_encoder(usage),
        }
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=run_context.inputs,
            process_data=process_data,
            outputs=outputs,
            edge_source_handle=category_id,
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
            },
            llm_usage=usage,
        )

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: QuestionClassifierNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        variable_mapping = {"query": node_data.query_variable_selector}
        variable_selectors: list[VariableSelector] = []
        if node_data.instruction:
            variable_template_parser = VariableTemplateParser(
                template=node_data.instruction,
            )
            variable_selectors.extend(
                variable_template_parser.extract_variable_selectors(),
            )
        for variable_selector in variable_selectors:
            variable_mapping[variable_selector.variable] = list(
                variable_selector.value_selector,
            )

        return {node_id + "." + key: value for key, value in variable_mapping.items()}

    @classmethod
    @override
    def get_default_config(
        cls,
        filters: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        """Build the default question-classifier node config."""
        _ = filters
        return {"type": "question-classifier", "config": {"instructions": ""}}

    def _calculate_rest_token(
        self,
        node_data: QuestionClassifierNodeData,
        query: str,
        model_instance: LLMProtocol,
        context: str | None,
    ) -> int:
        model_schema = llm_utils.fetch_model_schema(model_instance=model_instance)

        prompt_template = self._get_prompt_template(node_data, query, None, 2000)
        prompt_messages, _ = llm_utils.fetch_prompt_messages(
            prompt_template=prompt_template,
            sys_query="",
            sys_files=[],
            context=context or "",
            memory=None,
            model_instance=model_instance,
            stop=model_instance.stop,
            memory_config=node_data.memory,
            vision_enabled=False,
            vision_detail=node_data.vision.configs.detail,
            variable_pool=self.runtime_state.variable_pool,
            jinja2_variables=[],
            jinja2_template_renderer=self._template_renderer,
        )
        rest_tokens = 2000

        model_context_tokens = model_schema.model_properties.get(
            ModelPropertyKey.CONTEXT_SIZE,
        )
        if model_context_tokens:
            curr_message_tokens = model_instance.get_llm_num_tokens(prompt_messages)

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

    def _get_prompt_template(
        self,
        node_data: QuestionClassifierNodeData,
        query: str,
        memory: PromptMessageMemory | None,
        max_token_limit: int = 2000,
    ) -> list[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate:
        model_mode = LLMMode(node_data.model.mode)
        classes = node_data.classes
        categories = []
        for class_ in classes:
            category = {"category_id": class_.id, "category_name": class_.name}
            categories.append(category)
        instruction = node_data.instruction or ""
        input_text = query
        memory_str = ""
        if memory:
            memory_str = llm_utils.fetch_memory_text(
                memory=memory,
                max_token_limit=max_token_limit,
                message_limit=node_data.memory.window.size
                if node_data.memory and node_data.memory.window
                else None,
            )
        prompt_messages: list[LLMNodeChatModelMessage] = []
        if model_mode == LLMMode.CHAT:
            system_prompt_messages = LLMNodeChatModelMessage(
                role=PromptMessageRole.SYSTEM,
                text=QUESTION_CLASSIFIER_SYSTEM_PROMPT.format(histories=memory_str),
            )
            prompt_messages.append(system_prompt_messages)
            user_prompt_message_1 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER,
                text=QUESTION_CLASSIFIER_USER_PROMPT_1,
            )
            prompt_messages.append(user_prompt_message_1)
            assistant_prompt_message_1 = LLMNodeChatModelMessage(
                role=PromptMessageRole.ASSISTANT,
                text=QUESTION_CLASSIFIER_ASSISTANT_PROMPT_1,
            )
            prompt_messages.append(assistant_prompt_message_1)
            user_prompt_message_2 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER,
                text=QUESTION_CLASSIFIER_USER_PROMPT_2,
            )
            prompt_messages.append(user_prompt_message_2)
            assistant_prompt_message_2 = LLMNodeChatModelMessage(
                role=PromptMessageRole.ASSISTANT,
                text=QUESTION_CLASSIFIER_ASSISTANT_PROMPT_2,
            )
            prompt_messages.append(assistant_prompt_message_2)
            user_prompt_message_3 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER,
                text=QUESTION_CLASSIFIER_USER_PROMPT_3.format(
                    input_text=input_text,
                    categories=json.dumps(categories, ensure_ascii=False),
                    classification_instructions=instruction,
                ),
            )
            prompt_messages.append(user_prompt_message_3)
            return prompt_messages
        if model_mode == LLMMode.COMPLETION:
            return LLMNodeCompletionModelPromptTemplate(
                text=QUESTION_CLASSIFIER_COMPLETION_PROMPT.format(
                    histories=memory_str,
                    input_text=input_text,
                    categories=json.dumps(categories, ensure_ascii=False),
                    classification_instructions=instruction,
                ),
            )

        msg = f"Model mode {model_mode} not support."
        raise InvalidModelTypeError(msg)
