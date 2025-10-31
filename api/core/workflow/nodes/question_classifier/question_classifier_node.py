import json
import re
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities import LLMUsage, ModelPropertyKey, PromptMessageRole
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.workflow.entities import GraphInitParams
from core.workflow.enums import (
    ErrorStrategy,
    NodeExecutionType,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.node_events import ModelInvokeCompletedEvent, NodeRunResult
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig, VariableSelector
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.nodes.llm import LLMNode, LLMNodeChatModelMessage, LLMNodeCompletionModelPromptTemplate, llm_utils
from core.workflow.nodes.llm.file_saver import FileSaverImpl, LLMFileSaver
from libs.json_in_md_parser import parse_and_check_json_markdown

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

if TYPE_CHECKING:
    from core.file.models import File
    from core.workflow.runtime import GraphRuntimeState


class QuestionClassifierNode(Node):
    node_type = NodeType.QUESTION_CLASSIFIER
    execution_type = NodeExecutionType.BRANCH

    _node_data: QuestionClassifierNodeData

    _file_outputs: list["File"]
    _llm_file_saver: LLMFileSaver

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        *,
        llm_file_saver: LLMFileSaver | None = None,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        # LLM file outputs, used for MultiModal outputs.
        self._file_outputs = []

        if llm_file_saver is None:
            llm_file_saver = FileSaverImpl(
                user_id=graph_init_params.user_id,
                tenant_id=graph_init_params.tenant_id,
            )
        self._llm_file_saver = llm_file_saver

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = QuestionClassifierNodeData.model_validate(data)

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

    @classmethod
    def version(cls):
        return "1"

    def _run(self):
        node_data = self._node_data
        variable_pool = self.graph_runtime_state.variable_pool

        # extract variables
        variable = variable_pool.get(node_data.query_variable_selector) if node_data.query_variable_selector else None
        query = variable.value if variable else None
        variables = {"query": query}
        # fetch model config
        model_instance, model_config = llm_utils.fetch_model_config(
            tenant_id=self.tenant_id,
            node_data_model=node_data.model,
        )
        # fetch memory
        memory = llm_utils.fetch_memory(
            variable_pool=variable_pool,
            app_id=self.app_id,
            node_data_memory=node_data.memory,
            model_instance=model_instance,
        )
        # fetch instruction
        node_data.instruction = node_data.instruction or ""
        node_data.instruction = variable_pool.convert_template(node_data.instruction).text

        files = (
            llm_utils.fetch_files(
                variable_pool=variable_pool,
                selector=node_data.vision.configs.variable_selector,
            )
            if node_data.vision.enabled
            else []
        )

        # fetch prompt messages
        rest_token = self._calculate_rest_token(
            node_data=node_data,
            query=query or "",
            model_config=model_config,
            context="",
        )
        prompt_template = self._get_prompt_template(
            node_data=node_data,
            query=query or "",
            memory=memory,
            max_token_limit=rest_token,
        )
        # Some models (e.g. Gemma, Mistral) force roles alternation (user/assistant/user/assistant...).
        # If both self._get_prompt_template and self._fetch_prompt_messages append a user prompt,
        # two consecutive user prompts will be generated, causing model's error.
        # To avoid this, set sys_query to an empty string so that only one user prompt is appended at the end.
        prompt_messages, stop = LLMNode.fetch_prompt_messages(
            prompt_template=prompt_template,
            sys_query="",
            memory=memory,
            model_config=model_config,
            sys_files=files,
            vision_enabled=node_data.vision.enabled,
            vision_detail=node_data.vision.configs.detail,
            variable_pool=variable_pool,
            jinja2_variables=[],
            tenant_id=self.tenant_id,
        )

        result_text = ""
        usage = LLMUsage.empty_usage()
        finish_reason = None

        try:
            # handle invoke result
            generator = LLMNode.invoke_llm(
                node_data_model=node_data.model,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                stop=stop,
                user_id=self.user_id,
                structured_output_enabled=False,
                structured_output=None,
                file_saver=self._llm_file_saver,
                file_outputs=self._file_outputs,
                node_id=self._node_id,
                node_type=self.node_type,
            )

            for event in generator:
                if isinstance(event, ModelInvokeCompletedEvent):
                    result_text = event.text
                    usage = event.usage
                    finish_reason = event.finish_reason
                    break

            rendered_classes = [
                c.model_copy(update={"name": variable_pool.convert_template(c.name).text}) for c in node_data.classes
            ]

            category_name = rendered_classes[0].name
            category_id = rendered_classes[0].id
            if "<think>" in result_text:
                result_text = re.sub(r"<think[^>]*>[\s\S]*?</think>", "", result_text, flags=re.IGNORECASE)
            result_text_json = parse_and_check_json_markdown(result_text, [])
            # result_text_json = json.loads(result_text.strip('```JSON\n'))
            if "category_name" in result_text_json and "category_id" in result_text_json:
                category_id_result = result_text_json["category_id"]
                classes = rendered_classes
                classes_map = {class_.id: class_.name for class_ in classes}
                category_ids = [_class.id for _class in classes]
                if category_id_result in category_ids:
                    category_name = classes_map[category_id_result]
                    category_id = category_id_result
            process_data = {
                "model_mode": model_config.mode,
                "prompts": PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                    model_mode=model_config.mode, prompt_messages=prompt_messages
                ),
                "usage": jsonable_encoder(usage),
                "finish_reason": finish_reason,
                "model_provider": model_config.provider,
                "model_name": model_config.model,
            }
            outputs = {
                "class_name": category_name,
                "class_id": category_id,
                "usage": jsonable_encoder(usage),
            }

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=variables,
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
        except ValueError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                },
                llm_usage=usage,
            )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # graph_config is not used in this node type
        # Create typed NodeData from dict
        typed_node_data = QuestionClassifierNodeData.model_validate(node_data)

        variable_mapping = {"query": typed_node_data.query_variable_selector}
        variable_selectors: list[VariableSelector] = []
        if typed_node_data.instruction:
            variable_template_parser = VariableTemplateParser(template=typed_node_data.instruction)
            variable_selectors.extend(variable_template_parser.extract_variable_selectors())
        for variable_selector in variable_selectors:
            variable_mapping[variable_selector.variable] = list(variable_selector.value_selector)

        variable_mapping = {node_id + "." + key: value for key, value in variable_mapping.items()}

        return variable_mapping

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        """
        Get default config of node.
        :param filters: filter by node config parameters (not used in this implementation).
        :return:
        """
        # filters parameter is not used in this node type
        return {"type": "question-classifier", "config": {"instructions": ""}}

    def _calculate_rest_token(
        self,
        node_data: QuestionClassifierNodeData,
        query: str,
        model_config: ModelConfigWithCredentialsEntity,
        context: str | None,
    ) -> int:
        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)
        prompt_template = self._get_prompt_template(node_data, query, None, 2000)
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
            model_instance = ModelInstance(
                provider_model_bundle=model_config.provider_model_bundle, model=model_config.model
            )

            curr_message_tokens = model_instance.get_llm_num_tokens(prompt_messages)

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

    def _get_prompt_template(
        self,
        node_data: QuestionClassifierNodeData,
        query: str,
        memory: TokenBufferMemory | None,
        max_token_limit: int = 2000,
    ):
        model_mode = ModelMode(node_data.model.mode)
        classes = node_data.classes
        categories = []
        for class_ in classes:
            category = {"category_id": class_.id, "category_name": class_.name}
            categories.append(category)
        instruction = node_data.instruction or ""
        input_text = query
        memory_str = ""
        if memory:
            memory_str = memory.get_history_prompt_text(
                max_token_limit=max_token_limit,
                message_limit=node_data.memory.window.size if node_data.memory and node_data.memory.window else None,
            )
        prompt_messages: list[LLMNodeChatModelMessage] = []
        if model_mode == ModelMode.CHAT:
            system_prompt_messages = LLMNodeChatModelMessage(
                role=PromptMessageRole.SYSTEM, text=QUESTION_CLASSIFIER_SYSTEM_PROMPT.format(histories=memory_str)
            )
            prompt_messages.append(system_prompt_messages)
            user_prompt_message_1 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER, text=QUESTION_CLASSIFIER_USER_PROMPT_1
            )
            prompt_messages.append(user_prompt_message_1)
            assistant_prompt_message_1 = LLMNodeChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=QUESTION_CLASSIFIER_ASSISTANT_PROMPT_1
            )
            prompt_messages.append(assistant_prompt_message_1)
            user_prompt_message_2 = LLMNodeChatModelMessage(
                role=PromptMessageRole.USER, text=QUESTION_CLASSIFIER_USER_PROMPT_2
            )
            prompt_messages.append(user_prompt_message_2)
            assistant_prompt_message_2 = LLMNodeChatModelMessage(
                role=PromptMessageRole.ASSISTANT, text=QUESTION_CLASSIFIER_ASSISTANT_PROMPT_2
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
        elif model_mode == ModelMode.COMPLETION:
            return LLMNodeCompletionModelPromptTemplate(
                text=QUESTION_CLASSIFIER_COMPLETION_PROMPT.format(
                    histories=memory_str,
                    input_text=input_text,
                    categories=json.dumps(categories, ensure_ascii=False),
                    classification_instructions=instruction,
                )
            )

        else:
            raise InvalidModelTypeError(f"Model mode {model_mode} not support.")
