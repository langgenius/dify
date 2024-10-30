import json
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Optional, cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.model_entities import ModelStatus
from core.entities.provider_entities import QuotaUnit
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities import (
    AudioPromptMessageContent,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    TextPromptMessageContent,
)
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import CompletionModelPromptTemplate, MemoryConfig
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.variables import (
    ArrayAnySegment,
    ArrayFileSegment,
    ArraySegment,
    FileSegment,
    NoneSegment,
    ObjectSegment,
    StringSegment,
)
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.event import InNodeEvent
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event import (
    ModelInvokeCompletedEvent,
    NodeEvent,
    RunCompletedEvent,
    RunRetrieverResourceEvent,
    RunStreamChunkEvent,
)
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from extensions.ext_database import db
from models.model import Conversation
from models.provider import Provider, ProviderType
from models.workflow import WorkflowNodeExecutionStatus

from .entities import (
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    LLMNodeData,
    ModelConfig,
)

if TYPE_CHECKING:
    from core.file.models import File


class LLMNode(BaseNode[LLMNodeData]):
    _node_data_cls = LLMNodeData
    _node_type = NodeType.LLM

    def _run(self) -> NodeRunResult | Generator[NodeEvent | InNodeEvent, None, None]:
        node_inputs = None
        process_data = None

        try:
            # init messages template
            self.node_data.prompt_template = self._transform_chat_messages(self.node_data.prompt_template)

            # fetch variables and fetch values from variable pool
            inputs = self._fetch_inputs(node_data=self.node_data)

            # fetch jinja2 inputs
            jinja_inputs = self._fetch_jinja_inputs(node_data=self.node_data)

            # merge inputs
            inputs.update(jinja_inputs)

            node_inputs = {}

            # fetch files
            files = (
                self._fetch_files(selector=self.node_data.vision.configs.variable_selector)
                if self.node_data.vision.enabled
                else []
            )

            if files:
                node_inputs["#files#"] = [file.to_dict() for file in files]

            # fetch context value
            generator = self._fetch_context(node_data=self.node_data)
            context = None
            for event in generator:
                if isinstance(event, RunRetrieverResourceEvent):
                    context = event.context
                    yield event

            if context:
                node_inputs["#context#"] = context  # type: ignore

            # fetch model config
            model_instance, model_config = self._fetch_model_config(self.node_data.model)

            # fetch memory
            memory = self._fetch_memory(node_data_memory=self.node_data.memory, model_instance=model_instance)

            # fetch prompt messages
            if self.node_data.memory:
                query = self.graph_runtime_state.variable_pool.get((SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.QUERY))
                if not query:
                    raise ValueError("Query not found")
                query = query.text
            else:
                query = None

            prompt_messages, stop = self._fetch_prompt_messages(
                system_query=query,
                inputs=inputs,
                files=files,
                context=context,
                memory=memory,
                model_config=model_config,
                prompt_template=self.node_data.prompt_template,
                memory_config=self.node_data.memory,
                vision_enabled=self.node_data.vision.enabled,
                vision_detail=self.node_data.vision.configs.detail,
            )

            process_data = {
                "model_mode": model_config.mode,
                "prompts": PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                    model_mode=model_config.mode, prompt_messages=prompt_messages
                ),
                "model_provider": model_config.provider,
                "model_name": model_config.model,
            }

            # handle invoke result
            generator = self._invoke_llm(
                node_data_model=self.node_data.model,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                stop=stop,
            )

            result_text = ""
            usage = LLMUsage.empty_usage()
            finish_reason = None
            for event in generator:
                if isinstance(event, RunStreamChunkEvent):
                    yield event
                elif isinstance(event, ModelInvokeCompletedEvent):
                    result_text = event.text
                    usage = event.usage
                    finish_reason = event.finish_reason
                    break
        except Exception as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    inputs=node_inputs,
                    process_data=process_data,
                )
            )
            return

        outputs = {"text": result_text, "usage": jsonable_encoder(usage), "finish_reason": finish_reason}

        yield RunCompletedEvent(
            run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=node_inputs,
                process_data=process_data,
                outputs=outputs,
                metadata={
                    NodeRunMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    NodeRunMetadataKey.TOTAL_PRICE: usage.total_price,
                    NodeRunMetadataKey.CURRENCY: usage.currency,
                },
                llm_usage=usage,
            )
        )

    def _invoke_llm(
        self,
        node_data_model: ModelConfig,
        model_instance: ModelInstance,
        prompt_messages: list[PromptMessage],
        stop: Optional[list[str]] = None,
    ) -> Generator[NodeEvent, None, None]:
        db.session.close()

        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=node_data_model.completion_params,
            stop=stop,
            stream=True,
            user=self.user_id,
        )

        # handle invoke result
        generator = self._handle_invoke_result(invoke_result=invoke_result)

        usage = LLMUsage.empty_usage()
        for event in generator:
            yield event
            if isinstance(event, ModelInvokeCompletedEvent):
                usage = event.usage

        # deduct quota
        self.deduct_llm_quota(tenant_id=self.tenant_id, model_instance=model_instance, usage=usage)

    def _handle_invoke_result(self, invoke_result: LLMResult | Generator) -> Generator[NodeEvent, None, None]:
        if isinstance(invoke_result, LLMResult):
            return

        model = None
        prompt_messages: list[PromptMessage] = []
        full_text = ""
        usage = None
        finish_reason = None
        for result in invoke_result:
            text = result.delta.message.content
            full_text += text

            yield RunStreamChunkEvent(chunk_content=text, from_variable_selector=[self.node_id, "text"])

            if not model:
                model = result.model

            if not prompt_messages:
                prompt_messages = result.prompt_messages

            if not usage and result.delta.usage:
                usage = result.delta.usage

            if not finish_reason and result.delta.finish_reason:
                finish_reason = result.delta.finish_reason

        if not usage:
            usage = LLMUsage.empty_usage()

        yield ModelInvokeCompletedEvent(text=full_text, usage=usage, finish_reason=finish_reason)

    def _transform_chat_messages(
        self, messages: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate, /
    ) -> Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate:
        if isinstance(messages, LLMNodeCompletionModelPromptTemplate):
            if messages.edition_type == "jinja2" and messages.jinja2_text:
                messages.text = messages.jinja2_text

            return messages

        for message in messages:
            if message.edition_type == "jinja2" and message.jinja2_text:
                message.text = message.jinja2_text

        return messages

    def _fetch_jinja_inputs(self, node_data: LLMNodeData) -> dict[str, str]:
        variables = {}

        if not node_data.prompt_config:
            return variables

        for variable_selector in node_data.prompt_config.jinja2_variables or []:
            variable_name = variable_selector.variable
            variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            if variable is None:
                raise ValueError(f"Variable {variable_selector.variable} not found")

            def parse_dict(input_dict: Mapping[str, Any]) -> str:
                """
                Parse dict into string
                """
                # check if it's a context structure
                if "metadata" in input_dict and "_source" in input_dict["metadata"] and "content" in input_dict:
                    return input_dict["content"]

                # else, parse the dict
                try:
                    return json.dumps(input_dict, ensure_ascii=False)
                except Exception:
                    return str(input_dict)

            if isinstance(variable, ArraySegment):
                result = ""
                for item in variable.value:
                    if isinstance(item, dict):
                        result += parse_dict(item)
                    else:
                        result += str(item)
                    result += "\n"
                value = result.strip()
            elif isinstance(variable, ObjectSegment):
                value = parse_dict(variable.value)
            else:
                value = variable.text

            variables[variable_name] = value

        return variables

    def _fetch_inputs(self, node_data: LLMNodeData) -> dict[str, Any]:
        inputs = {}
        prompt_template = node_data.prompt_template

        variable_selectors = []
        if isinstance(prompt_template, list):
            for prompt in prompt_template:
                variable_template_parser = VariableTemplateParser(template=prompt.text)
                variable_selectors.extend(variable_template_parser.extract_variable_selectors())
        elif isinstance(prompt_template, CompletionModelPromptTemplate):
            variable_template_parser = VariableTemplateParser(template=prompt_template.text)
            variable_selectors = variable_template_parser.extract_variable_selectors()

        for variable_selector in variable_selectors:
            variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            if variable is None:
                raise ValueError(f"Variable {variable_selector.variable} not found")
            if isinstance(variable, NoneSegment):
                inputs[variable_selector.variable] = ""
            inputs[variable_selector.variable] = variable.to_object()

        memory = node_data.memory
        if memory and memory.query_prompt_template:
            query_variable_selectors = VariableTemplateParser(
                template=memory.query_prompt_template
            ).extract_variable_selectors()
            for variable_selector in query_variable_selectors:
                variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
                if variable is None:
                    raise ValueError(f"Variable {variable_selector.variable} not found")
                if isinstance(variable, NoneSegment):
                    continue
                inputs[variable_selector.variable] = variable.to_object()

        return inputs

    def _fetch_files(self, *, selector: Sequence[str]) -> Sequence["File"]:
        variable = self.graph_runtime_state.variable_pool.get(selector)
        if variable is None:
            return []
        elif isinstance(variable, FileSegment):
            return [variable.value]
        elif isinstance(variable, ArrayFileSegment):
            return variable.value
        elif isinstance(variable, NoneSegment | ArrayAnySegment):
            return []
        raise ValueError(f"Invalid variable type: {type(variable)}")

    def _fetch_context(self, node_data: LLMNodeData):
        if not node_data.context.enabled:
            return

        if not node_data.context.variable_selector:
            return

        context_value_variable = self.graph_runtime_state.variable_pool.get(node_data.context.variable_selector)
        if context_value_variable:
            if isinstance(context_value_variable, StringSegment):
                yield RunRetrieverResourceEvent(retriever_resources=[], context=context_value_variable.value)
            elif isinstance(context_value_variable, ArraySegment):
                context_str = ""
                original_retriever_resource = []
                for item in context_value_variable.value:
                    if isinstance(item, str):
                        context_str += item + "\n"
                    else:
                        if "content" not in item:
                            raise ValueError(f"Invalid context structure: {item}")

                        context_str += item["content"] + "\n"

                        retriever_resource = self._convert_to_original_retriever_resource(item)
                        if retriever_resource:
                            original_retriever_resource.append(retriever_resource)

                yield RunRetrieverResourceEvent(
                    retriever_resources=original_retriever_resource, context=context_str.strip()
                )

    def _convert_to_original_retriever_resource(self, context_dict: dict) -> Optional[dict]:
        if (
            "metadata" in context_dict
            and "_source" in context_dict["metadata"]
            and context_dict["metadata"]["_source"] == "knowledge"
        ):
            metadata = context_dict.get("metadata", {})

            source = {
                "position": metadata.get("position"),
                "dataset_id": metadata.get("dataset_id"),
                "dataset_name": metadata.get("dataset_name"),
                "document_id": metadata.get("document_id"),
                "document_name": metadata.get("document_name"),
                "data_source_type": metadata.get("document_data_source_type"),
                "segment_id": metadata.get("segment_id"),
                "retriever_from": metadata.get("retriever_from"),
                "score": metadata.get("score"),
                "hit_count": metadata.get("segment_hit_count"),
                "word_count": metadata.get("segment_word_count"),
                "segment_position": metadata.get("segment_position"),
                "index_node_hash": metadata.get("segment_index_node_hash"),
                "content": context_dict.get("content"),
                "page": metadata.get("page"),
            }

            return source

        return None

    def _fetch_model_config(
        self, node_data_model: ModelConfig
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        model_name = node_data_model.name
        provider_name = node_data_model.provider

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id, model_type=ModelType.LLM, provider=provider_name, model=model_name
        )

        provider_model_bundle = model_instance.provider_model_bundle
        model_type_instance = model_instance.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_credentials = model_instance.credentials

        # check model
        provider_model = provider_model_bundle.configuration.get_provider_model(
            model=model_name, model_type=ModelType.LLM
        )

        if provider_model is None:
            raise ValueError(f"Model {model_name} not exist.")

        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")
        elif provider_model.status == ModelStatus.NO_PERMISSION:
            raise ModelCurrentlyNotSupportError(f"Dify Hosted OpenAI {model_name} currently not support.")
        elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise QuotaExceededError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = node_data_model.completion_params
        stop = []
        if "stop" in completion_params:
            stop = completion_params["stop"]
            del completion_params["stop"]

        # get model mode
        model_mode = node_data_model.mode
        if not model_mode:
            raise ValueError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(model_name, model_credentials)

        if not model_schema:
            raise ValueError(f"Model {model_name} not exist.")

        return model_instance, ModelConfigWithCredentialsEntity(
            provider=provider_name,
            model=model_name,
            model_schema=model_schema,
            mode=model_mode,
            provider_model_bundle=provider_model_bundle,
            credentials=model_credentials,
            parameters=completion_params,
            stop=stop,
        )

    def _fetch_memory(
        self, node_data_memory: Optional[MemoryConfig], model_instance: ModelInstance
    ) -> Optional[TokenBufferMemory]:
        if not node_data_memory:
            return None

        # get conversation id
        conversation_id_variable = self.graph_runtime_state.variable_pool.get(
            ["sys", SystemVariableKey.CONVERSATION_ID.value]
        )
        if not isinstance(conversation_id_variable, StringSegment):
            return None
        conversation_id = conversation_id_variable.value

        # get conversation
        conversation = (
            db.session.query(Conversation)
            .filter(Conversation.app_id == self.app_id, Conversation.id == conversation_id)
            .first()
        )

        if not conversation:
            return None

        memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

        return memory

    def _fetch_prompt_messages(
        self,
        *,
        system_query: str | None = None,
        inputs: dict[str, str] | None = None,
        files: Sequence["File"],
        context: str | None = None,
        memory: TokenBufferMemory | None = None,
        model_config: ModelConfigWithCredentialsEntity,
        prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate,
        memory_config: MemoryConfig | None = None,
        vision_enabled: bool = False,
        vision_detail: ImagePromptMessageContent.DETAIL,
    ) -> tuple[list[PromptMessage], Optional[list[str]]]:
        inputs = inputs or {}

        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs=inputs,
            query=system_query or "",
            files=files,
            context=context,
            memory_config=memory_config,
            memory=memory,
            model_config=model_config,
        )
        stop = model_config.stop
        filtered_prompt_messages = []
        for prompt_message in prompt_messages:
            if prompt_message.is_empty():
                continue

            if not isinstance(prompt_message.content, str):
                prompt_message_content = []
                for content_item in prompt_message.content or []:
                    # Skip image if vision is disabled
                    if not vision_enabled and content_item.type == PromptMessageContentType.IMAGE:
                        continue

                    if isinstance(content_item, ImagePromptMessageContent):
                        # Override vision config if LLM node has vision config,
                        # cuz vision detail is related to the configuration from FileUpload feature.
                        content_item.detail = vision_detail
                        prompt_message_content.append(content_item)
                    elif isinstance(content_item, TextPromptMessageContent | AudioPromptMessageContent):
                        prompt_message_content.append(content_item)

                if len(prompt_message_content) > 1:
                    prompt_message.content = prompt_message_content
                elif (
                    len(prompt_message_content) == 1 and prompt_message_content[0].type == PromptMessageContentType.TEXT
                ):
                    prompt_message.content = prompt_message_content[0].data

            filtered_prompt_messages.append(prompt_message)

        if not filtered_prompt_messages:
            raise ValueError(
                "No prompt found in the LLM configuration. "
                "Please ensure a prompt is properly configured before proceeding."
            )

        return filtered_prompt_messages, stop

    @classmethod
    def deduct_llm_quota(cls, tenant_id: str, model_instance: ModelInstance, usage: LLMUsage) -> None:
        provider_model_bundle = model_instance.provider_model_bundle
        provider_configuration = provider_model_bundle.configuration

        if provider_configuration.using_provider_type != ProviderType.SYSTEM:
            return

        system_configuration = provider_configuration.system_configuration

        quota_unit = None
        for quota_configuration in system_configuration.quota_configurations:
            if quota_configuration.quota_type == system_configuration.current_quota_type:
                quota_unit = quota_configuration.quota_unit

                if quota_configuration.quota_limit == -1:
                    return

                break

        used_quota = None
        if quota_unit:
            if quota_unit == QuotaUnit.TOKENS:
                used_quota = usage.total_tokens
            elif quota_unit == QuotaUnit.CREDITS:
                used_quota = 1

                if "gpt-4" in model_instance.model:
                    used_quota = 20
            else:
                used_quota = 1

        if used_quota is not None and system_configuration.current_quota_type is not None:
            db.session.query(Provider).filter(
                Provider.tenant_id == tenant_id,
                Provider.provider_name == model_instance.provider,
                Provider.provider_type == ProviderType.SYSTEM.value,
                Provider.quota_type == system_configuration.current_quota_type.value,
                Provider.quota_limit > Provider.quota_used,
            ).update({"quota_used": Provider.quota_used + used_quota})
            db.session.commit()

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: LLMNodeData,
    ) -> Mapping[str, Sequence[str]]:
        prompt_template = node_data.prompt_template

        variable_selectors = []
        if isinstance(prompt_template, list) and all(
            isinstance(prompt, LLMNodeChatModelMessage) for prompt in prompt_template
        ):
            for prompt in prompt_template:
                if prompt.edition_type != "jinja2":
                    variable_template_parser = VariableTemplateParser(template=prompt.text)
                    variable_selectors.extend(variable_template_parser.extract_variable_selectors())
        elif isinstance(prompt_template, LLMNodeCompletionModelPromptTemplate):
            if prompt_template.edition_type != "jinja2":
                variable_template_parser = VariableTemplateParser(template=prompt_template.text)
                variable_selectors = variable_template_parser.extract_variable_selectors()
        else:
            raise ValueError(f"Invalid prompt template type: {type(prompt_template)}")

        variable_mapping = {}
        for variable_selector in variable_selectors:
            variable_mapping[variable_selector.variable] = variable_selector.value_selector

        memory = node_data.memory
        if memory and memory.query_prompt_template:
            query_variable_selectors = VariableTemplateParser(
                template=memory.query_prompt_template
            ).extract_variable_selectors()
            for variable_selector in query_variable_selectors:
                variable_mapping[variable_selector.variable] = variable_selector.value_selector

        if node_data.context.enabled:
            variable_mapping["#context#"] = node_data.context.variable_selector

        if node_data.vision.enabled:
            variable_mapping["#files#"] = ["sys", SystemVariableKey.FILES.value]

        if node_data.memory:
            variable_mapping["#sys.query#"] = ["sys", SystemVariableKey.QUERY.value]

        if node_data.prompt_config:
            enable_jinja = False

            if isinstance(prompt_template, list):
                for prompt in prompt_template:
                    if prompt.edition_type == "jinja2":
                        enable_jinja = True
                        break
            else:
                if prompt_template.edition_type == "jinja2":
                    enable_jinja = True

            if enable_jinja:
                for variable_selector in node_data.prompt_config.jinja2_variables or []:
                    variable_mapping[variable_selector.variable] = variable_selector.value_selector

        variable_mapping = {node_id + "." + key: value for key, value in variable_mapping.items()}

        return variable_mapping

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        return {
            "type": "llm",
            "config": {
                "prompt_templates": {
                    "chat_model": {
                        "prompts": [
                            {"role": "system", "text": "You are a helpful AI assistant.", "edition_type": "basic"}
                        ]
                    },
                    "completion_model": {
                        "conversation_histories_role": {"user_prefix": "Human", "assistant_prefix": "Assistant"},
                        "prompt": {
                            "text": "Here is the chat histories between human and assistant, inside "
                            "<histories></histories> XML tags.\n\n<histories>\n{{"
                            "#histories#}}\n</histories>\n\n\nHuman: {{#sys.query#}}\n\nAssistant:",
                            "edition_type": "basic",
                        },
                        "stop": ["Human:"],
                    },
                }
            },
        }
