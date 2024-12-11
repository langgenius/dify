import json
import logging
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Optional, cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.model_entities import ModelStatus
from core.entities.provider_entities import QuotaUnit
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.file import FileType, file_manager
from core.helper.code_executor import CodeExecutor, CodeLanguage
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    TextPromptMessageContent,
)
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageContent,
    PromptMessageRole,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey, ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
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
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.entities.variable_pool import VariablePool
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
from .exc import (
    InvalidContextStructureError,
    InvalidVariableTypeError,
    LLMModeRequiredError,
    LLMNodeError,
    MemoryRolePrefixRequiredError,
    ModelNotExistError,
    NoPromptFoundError,
    TemplateTypeNotSupportError,
    VariableNotFoundError,
)

if TYPE_CHECKING:
    from core.file.models import File

logger = logging.getLogger(__name__)


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
                node_inputs["#context#"] = context

            # fetch model config
            model_instance, model_config = self._fetch_model_config(self.node_data.model)

            # fetch memory
            memory = self._fetch_memory(node_data_memory=self.node_data.memory, model_instance=model_instance)

            query = None
            if self.node_data.memory:
                query = self.node_data.memory.query_prompt_template
                if not query and (
                    query_variable := self.graph_runtime_state.variable_pool.get(
                        (SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.QUERY)
                    )
                ):
                    query = query_variable.text

            prompt_messages, stop = self._fetch_prompt_messages(
                user_query=query,
                user_files=files,
                context=context,
                memory=memory,
                model_config=model_config,
                prompt_template=self.node_data.prompt_template,
                memory_config=self.node_data.memory,
                vision_enabled=self.node_data.vision.enabled,
                vision_detail=self.node_data.vision.configs.detail,
                variable_pool=self.graph_runtime_state.variable_pool,
                jinja2_variables=self.node_data.prompt_config.jinja2_variables,
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
        except LLMNodeError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    inputs=node_inputs,
                    process_data=process_data,
                    error_type=type(e).__name__,
                )
            )
            return
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
        prompt_messages: Sequence[PromptMessage],
        stop: Optional[Sequence[str]] = None,
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
                raise VariableNotFoundError(f"Variable {variable_selector.variable} not found")

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
                raise VariableNotFoundError(f"Variable {variable_selector.variable} not found")
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
                    raise VariableNotFoundError(f"Variable {variable_selector.variable} not found")
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
        raise InvalidVariableTypeError(f"Invalid variable type: {type(variable)}")

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
                            raise InvalidContextStructureError(f"Invalid context structure: {item}")

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
            raise ModelNotExistError(f"Model {model_name} not exist.")

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
            raise LLMModeRequiredError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(model_name, model_credentials)

        if not model_schema:
            raise ModelNotExistError(f"Model {model_name} not exist.")

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
        user_query: str | None = None,
        user_files: Sequence["File"],
        context: str | None = None,
        memory: TokenBufferMemory | None = None,
        model_config: ModelConfigWithCredentialsEntity,
        prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate,
        memory_config: MemoryConfig | None = None,
        vision_enabled: bool = False,
        vision_detail: ImagePromptMessageContent.DETAIL,
        variable_pool: VariablePool,
        jinja2_variables: Sequence[VariableSelector],
    ) -> tuple[Sequence[PromptMessage], Optional[Sequence[str]]]:
        prompt_messages = []

        if isinstance(prompt_template, list):
            # For chat model
            prompt_messages.extend(
                _handle_list_messages(
                    messages=prompt_template,
                    context=context,
                    jinja2_variables=jinja2_variables,
                    variable_pool=variable_pool,
                    vision_detail_config=vision_detail,
                )
            )

            # Get memory messages for chat mode
            memory_messages = _handle_memory_chat_mode(
                memory=memory,
                memory_config=memory_config,
                model_config=model_config,
            )
            # Extend prompt_messages with memory messages
            prompt_messages.extend(memory_messages)

            # Add current query to the prompt messages
            if user_query:
                message = LLMNodeChatModelMessage(
                    text=user_query,
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                )
                prompt_messages.extend(
                    _handle_list_messages(
                        messages=[message],
                        context="",
                        jinja2_variables=[],
                        variable_pool=variable_pool,
                        vision_detail_config=vision_detail,
                    )
                )

        elif isinstance(prompt_template, LLMNodeCompletionModelPromptTemplate):
            # For completion model
            prompt_messages.extend(
                _handle_completion_template(
                    template=prompt_template,
                    context=context,
                    jinja2_variables=jinja2_variables,
                    variable_pool=variable_pool,
                )
            )

            # Get memory text for completion model
            memory_text = _handle_memory_completion_mode(
                memory=memory,
                memory_config=memory_config,
                model_config=model_config,
            )
            # Insert histories into the prompt
            prompt_content = prompt_messages[0].content
            # For issue #11247 - Check if prompt content is a string or a list
            prompt_content_type = type(prompt_content)
            if prompt_content_type == str:
                if "#histories#" in prompt_content:
                    prompt_content = prompt_content.replace("#histories#", memory_text)
                else:
                    prompt_content = memory_text + "\n" + prompt_content
                prompt_messages[0].content = prompt_content
            elif prompt_content_type == list:
                for content_item in prompt_content:
                    if content_item.type == PromptMessageContentType.TEXT:
                        if "#histories#" in content_item.data:
                            content_item.data = content_item.data.replace("#histories#", memory_text)
                        else:
                            content_item.data = memory_text + "\n" + content_item.data
            else:
                raise ValueError("Invalid prompt content type")

            # Add current query to the prompt message
            if user_query:
                if prompt_content_type == str:
                    prompt_content = prompt_messages[0].content.replace("#sys.query#", user_query)
                    prompt_messages[0].content = prompt_content
                elif prompt_content_type == list:
                    for content_item in prompt_content:
                        if content_item.type == PromptMessageContentType.TEXT:
                            content_item.data = user_query + "\n" + content_item.data
                else:
                    raise ValueError("Invalid prompt content type")
        else:
            raise TemplateTypeNotSupportError(type_name=str(type(prompt_template)))

        if vision_enabled and user_files:
            file_prompts = []
            for file in user_files:
                file_prompt = file_manager.to_prompt_message_content(file, image_detail_config=vision_detail)
                file_prompts.append(file_prompt)
            if (
                len(prompt_messages) > 0
                and isinstance(prompt_messages[-1], UserPromptMessage)
                and isinstance(prompt_messages[-1].content, list)
            ):
                prompt_messages[-1] = UserPromptMessage(content=prompt_messages[-1].content + file_prompts)
            else:
                prompt_messages.append(UserPromptMessage(content=file_prompts))

        # Filter prompt messages
        filtered_prompt_messages = []
        for prompt_message in prompt_messages:
            if isinstance(prompt_message.content, list):
                prompt_message_content = []
                for content_item in prompt_message.content:
                    # Skip content if features are not defined
                    if not model_config.model_schema.features:
                        if content_item.type != PromptMessageContentType.TEXT:
                            continue
                        prompt_message_content.append(content_item)
                        continue

                    # Skip content if corresponding feature is not supported
                    if (
                        (
                            content_item.type == PromptMessageContentType.IMAGE
                            and ModelFeature.VISION not in model_config.model_schema.features
                        )
                        or (
                            content_item.type == PromptMessageContentType.DOCUMENT
                            and ModelFeature.DOCUMENT not in model_config.model_schema.features
                        )
                        or (
                            content_item.type == PromptMessageContentType.VIDEO
                            and ModelFeature.VIDEO not in model_config.model_schema.features
                        )
                        or (
                            content_item.type == PromptMessageContentType.AUDIO
                            and ModelFeature.AUDIO not in model_config.model_schema.features
                        )
                    ):
                        continue
                    prompt_message_content.append(content_item)
                if len(prompt_message_content) == 1 and prompt_message_content[0].type == PromptMessageContentType.TEXT:
                    prompt_message.content = prompt_message_content[0].data
                else:
                    prompt_message.content = prompt_message_content
            if prompt_message.is_empty():
                continue
            filtered_prompt_messages.append(prompt_message)

        if len(filtered_prompt_messages) == 0:
            raise NoPromptFoundError(
                "No prompt found in the LLM configuration. "
                "Please ensure a prompt is properly configured before proceeding."
            )

        stop = model_config.stop
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
            raise InvalidVariableTypeError(f"Invalid prompt template type: {type(prompt_template)}")

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
                            "text": "Here are the chat histories between human and assistant, inside "
                            "<histories></histories> XML tags.\n\n<histories>\n{{"
                            "#histories#}}\n</histories>\n\n\nHuman: {{#sys.query#}}\n\nAssistant:",
                            "edition_type": "basic",
                        },
                        "stop": ["Human:"],
                    },
                }
            },
        }


def _combine_message_content_with_role(*, contents: Sequence[PromptMessageContent], role: PromptMessageRole):
    match role:
        case PromptMessageRole.USER:
            return UserPromptMessage(content=contents)
        case PromptMessageRole.ASSISTANT:
            return AssistantPromptMessage(content=contents)
        case PromptMessageRole.SYSTEM:
            return SystemPromptMessage(content=contents)
    raise NotImplementedError(f"Role {role} is not supported")


def _render_jinja2_message(
    *,
    template: str,
    jinjia2_variables: Sequence[VariableSelector],
    variable_pool: VariablePool,
):
    if not template:
        return ""

    jinjia2_inputs = {}
    for jinja2_variable in jinjia2_variables:
        variable = variable_pool.get(jinja2_variable.value_selector)
        jinjia2_inputs[jinja2_variable.variable] = variable.to_object() if variable else ""
    code_execute_resp = CodeExecutor.execute_workflow_code_template(
        language=CodeLanguage.JINJA2,
        code=template,
        inputs=jinjia2_inputs,
    )
    result_text = code_execute_resp["result"]
    return result_text


def _handle_list_messages(
    *,
    messages: Sequence[LLMNodeChatModelMessage],
    context: Optional[str],
    jinja2_variables: Sequence[VariableSelector],
    variable_pool: VariablePool,
    vision_detail_config: ImagePromptMessageContent.DETAIL,
) -> Sequence[PromptMessage]:
    prompt_messages = []
    for message in messages:
        if message.edition_type == "jinja2":
            result_text = _render_jinja2_message(
                template=message.jinja2_text or "",
                jinjia2_variables=jinja2_variables,
                variable_pool=variable_pool,
            )
            prompt_message = _combine_message_content_with_role(
                contents=[TextPromptMessageContent(data=result_text)], role=message.role
            )
            prompt_messages.append(prompt_message)
        else:
            # Get segment group from basic message
            if context:
                template = message.text.replace("{#context#}", context)
            else:
                template = message.text
            segment_group = variable_pool.convert_template(template)

            # Process segments for images
            file_contents = []
            for segment in segment_group.value:
                if isinstance(segment, ArrayFileSegment):
                    for file in segment.value:
                        if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                            file_content = file_manager.to_prompt_message_content(
                                file, image_detail_config=vision_detail_config
                            )
                            file_contents.append(file_content)
                if isinstance(segment, FileSegment):
                    file = segment.value
                    if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                        file_content = file_manager.to_prompt_message_content(
                            file, image_detail_config=vision_detail_config
                        )
                        file_contents.append(file_content)

            # Create message with text from all segments
            plain_text = segment_group.text
            if plain_text:
                prompt_message = _combine_message_content_with_role(
                    contents=[TextPromptMessageContent(data=plain_text)], role=message.role
                )
                prompt_messages.append(prompt_message)

            if file_contents:
                # Create message with image contents
                prompt_message = _combine_message_content_with_role(contents=file_contents, role=message.role)
                prompt_messages.append(prompt_message)

    return prompt_messages


def _calculate_rest_token(
    *, prompt_messages: list[PromptMessage], model_config: ModelConfigWithCredentialsEntity
) -> int:
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
                    or model_config.parameters.get(str(parameter_rule.use_template))
                    or 0
                )

        rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
        rest_tokens = max(rest_tokens, 0)

    return rest_tokens


def _handle_memory_chat_mode(
    *,
    memory: TokenBufferMemory | None,
    memory_config: MemoryConfig | None,
    model_config: ModelConfigWithCredentialsEntity,
) -> Sequence[PromptMessage]:
    memory_messages = []
    # Get messages from memory for chat model
    if memory and memory_config:
        rest_tokens = _calculate_rest_token(prompt_messages=[], model_config=model_config)
        memory_messages = memory.get_history_prompt_messages(
            max_token_limit=rest_tokens,
            message_limit=memory_config.window.size if memory_config.window.enabled else None,
        )
    return memory_messages


def _handle_memory_completion_mode(
    *,
    memory: TokenBufferMemory | None,
    memory_config: MemoryConfig | None,
    model_config: ModelConfigWithCredentialsEntity,
) -> str:
    memory_text = ""
    # Get history text from memory for completion model
    if memory and memory_config:
        rest_tokens = _calculate_rest_token(prompt_messages=[], model_config=model_config)
        if not memory_config.role_prefix:
            raise MemoryRolePrefixRequiredError("Memory role prefix is required for completion model.")
        memory_text = memory.get_history_prompt_text(
            max_token_limit=rest_tokens,
            message_limit=memory_config.window.size if memory_config.window.enabled else None,
            human_prefix=memory_config.role_prefix.user,
            ai_prefix=memory_config.role_prefix.assistant,
        )
    return memory_text


def _handle_completion_template(
    *,
    template: LLMNodeCompletionModelPromptTemplate,
    context: Optional[str],
    jinja2_variables: Sequence[VariableSelector],
    variable_pool: VariablePool,
) -> Sequence[PromptMessage]:
    """Handle completion template processing outside of LLMNode class.

    Args:
        template: The completion model prompt template
        context: Optional context string
        jinja2_variables: Variables for jinja2 template rendering
        variable_pool: Variable pool for template conversion

    Returns:
        Sequence of prompt messages
    """
    prompt_messages = []
    if template.edition_type == "jinja2":
        result_text = _render_jinja2_message(
            template=template.jinja2_text or "",
            jinjia2_variables=jinja2_variables,
            variable_pool=variable_pool,
        )
    else:
        if context:
            template_text = template.text.replace("{#context#}", context)
        else:
            template_text = template.text
        result_text = variable_pool.convert_template(template_text).text
    prompt_message = _combine_message_content_with_role(
        contents=[TextPromptMessageContent(data=result_text)], role=PromptMessageRole.USER
    )
    prompt_messages.append(prompt_message)
    return prompt_messages
