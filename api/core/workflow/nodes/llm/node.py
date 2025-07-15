import base64
import io
import json
import logging
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Optional, cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.file import FileType, file_manager
from core.helper.code_executor import CodeExecutor, CodeLanguage
from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    TextPromptMessageContent,
)
from core.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkWithStructuredOutput,
    LLMStructuredOutput,
    LLMUsage,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageContentUnionTypes,
    PromptMessageRole,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
)
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.entities.advanced_prompt_entities import CompletionModelPromptTemplate, MemoryConfig
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.variables import (
    ArrayFileSegment,
    ArraySegment,
    FileSegment,
    NoneSegment,
    ObjectSegment,
    StringSegment,
)
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
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

from . import llm_utils
from .entities import (
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    LLMNodeData,
    ModelConfig,
)
from .exc import (
    InvalidContextStructureError,
    InvalidVariableTypeError,
    LLMNodeError,
    MemoryRolePrefixRequiredError,
    ModelNotExistError,
    NoPromptFoundError,
    TemplateTypeNotSupportError,
    VariableNotFoundError,
)
from .file_saver import FileSaverImpl, LLMFileSaver

if TYPE_CHECKING:
    from core.file.models import File
    from core.workflow.graph_engine.entities.graph import Graph
    from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
    from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState

logger = logging.getLogger(__name__)


class LLMNode(BaseNode[LLMNodeData]):
    _node_data_cls = LLMNodeData
    _node_type = NodeType.LLM

    # Instance attributes specific to LLMNode.
    # Output variable for file
    _file_outputs: list["File"]

    _llm_file_saver: LLMFileSaver

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph: "Graph",
        graph_runtime_state: "GraphRuntimeState",
        previous_node_id: Optional[str] = None,
        thread_pool_id: Optional[str] = None,
        *,
        llm_file_saver: LLMFileSaver | None = None,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph=graph,
            graph_runtime_state=graph_runtime_state,
            previous_node_id=previous_node_id,
            thread_pool_id=thread_pool_id,
        )
        # LLM file outputs, used for MultiModal outputs.
        self._file_outputs: list[File] = []

        if llm_file_saver is None:
            llm_file_saver = FileSaverImpl(
                user_id=graph_init_params.user_id,
                tenant_id=graph_init_params.tenant_id,
            )
        self._llm_file_saver = llm_file_saver

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator[NodeEvent | InNodeEvent, None, None]:
        node_inputs: Optional[dict[str, Any]] = None
        process_data = None
        result_text = ""
        usage = LLMUsage.empty_usage()
        finish_reason = None
        variable_pool = self.graph_runtime_state.variable_pool

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
                llm_utils.fetch_files(
                    variable_pool=variable_pool,
                    selector=self.node_data.vision.configs.variable_selector,
                )
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
            memory = llm_utils.fetch_memory(
                variable_pool=variable_pool,
                app_id=self.app_id,
                node_data_memory=self.node_data.memory,
                model_instance=model_instance,
            )

            query = None
            if self.node_data.memory:
                query = self.node_data.memory.query_prompt_template
                if not query and (
                    query_variable := variable_pool.get((SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.QUERY))
                ):
                    query = query_variable.text

            prompt_messages, stop = self._fetch_prompt_messages(
                sys_query=query,
                sys_files=files,
                context=context,
                memory=memory,
                model_config=model_config,
                prompt_template=self.node_data.prompt_template,
                memory_config=self.node_data.memory,
                vision_enabled=self.node_data.vision.enabled,
                vision_detail=self.node_data.vision.configs.detail,
                variable_pool=variable_pool,
                jinja2_variables=self.node_data.prompt_config.jinja2_variables,
            )

            # handle invoke result
            generator = self._invoke_llm(
                node_data_model=self.node_data.model,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                stop=stop,
            )

            structured_output: LLMStructuredOutput | None = None

            for event in generator:
                if isinstance(event, RunStreamChunkEvent):
                    yield event
                elif isinstance(event, ModelInvokeCompletedEvent):
                    result_text = event.text
                    usage = event.usage
                    finish_reason = event.finish_reason
                    # deduct quota
                    llm_utils.deduct_llm_quota(tenant_id=self.tenant_id, model_instance=model_instance, usage=usage)
                    break
                elif isinstance(event, LLMStructuredOutput):
                    structured_output = event

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

            outputs = {"text": result_text, "usage": jsonable_encoder(usage), "finish_reason": finish_reason}
            if structured_output:
                outputs["structured_output"] = structured_output.structured_output
            if self._file_outputs is not None:
                outputs["files"] = ArrayFileSegment(value=self._file_outputs)

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=node_inputs,
                    process_data=process_data,
                    outputs=outputs,
                    metadata={
                        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                        WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                        WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
                    },
                    llm_usage=usage,
                )
            )
        except ValueError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    inputs=node_inputs,
                    process_data=process_data,
                    error_type=type(e).__name__,
                )
            )
        except Exception as e:
            logger.exception("error while executing llm node")
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    inputs=node_inputs,
                    process_data=process_data,
                )
            )

    def _invoke_llm(
        self,
        node_data_model: ModelConfig,
        model_instance: ModelInstance,
        prompt_messages: Sequence[PromptMessage],
        stop: Optional[Sequence[str]] = None,
    ) -> Generator[NodeEvent | LLMStructuredOutput, None, None]:
        model_schema = model_instance.model_type_instance.get_model_schema(
            node_data_model.name, model_instance.credentials
        )
        if not model_schema:
            raise ValueError(f"Model schema not found for {node_data_model.name}")

        if self.node_data.structured_output_enabled:
            output_schema = self._fetch_structured_output_schema()
            invoke_result = invoke_llm_with_structured_output(
                provider=model_instance.provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                json_schema=output_schema,
                model_parameters=node_data_model.completion_params,
                stop=list(stop or []),
                stream=True,
                user=self.user_id,
            )
        else:
            invoke_result = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages),
                model_parameters=node_data_model.completion_params,
                stop=list(stop or []),
                stream=True,
                user=self.user_id,
            )

        return self._handle_invoke_result(invoke_result=invoke_result)

    def _handle_invoke_result(
        self, invoke_result: LLMResult | Generator[LLMResultChunk | LLMStructuredOutput, None, None]
    ) -> Generator[NodeEvent | LLMStructuredOutput, None, None]:
        # For blocking mode
        if isinstance(invoke_result, LLMResult):
            event = self._handle_blocking_result(invoke_result=invoke_result)
            yield event
            return

        # For streaming mode
        model = ""
        prompt_messages: list[PromptMessage] = []

        usage = LLMUsage.empty_usage()
        finish_reason = None
        full_text_buffer = io.StringIO()
        # Consume the invoke result and handle generator exception
        try:
            for result in invoke_result:
                if isinstance(result, LLMResultChunkWithStructuredOutput):
                    yield result
                if isinstance(result, LLMResultChunk):
                    contents = result.delta.message.content
                    for text_part in self._save_multimodal_output_and_convert_result_to_markdown(contents):
                        full_text_buffer.write(text_part)
                        yield RunStreamChunkEvent(
                            chunk_content=text_part, from_variable_selector=[self.node_id, "text"]
                        )

                    # Update the whole metadata
                    if not model and result.model:
                        model = result.model
                    if len(prompt_messages) == 0:
                        # TODO(QuantumGhost): it seems that this update has no visable effect.
                        # What's the purpose of the line below?
                        prompt_messages = list(result.prompt_messages)
                    if usage.prompt_tokens == 0 and result.delta.usage:
                        usage = result.delta.usage
                    if finish_reason is None and result.delta.finish_reason:
                        finish_reason = result.delta.finish_reason
        except OutputParserError as e:
            raise LLMNodeError(f"Failed to parse structured output: {e}")

        yield ModelInvokeCompletedEvent(text=full_text_buffer.getvalue(), usage=usage, finish_reason=finish_reason)

    def _image_file_to_markdown(self, file: "File", /):
        text_chunk = f"![]({file.generate_url()})"
        return text_chunk

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
        variables: dict[str, Any] = {}

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
                    return str(input_dict["content"])

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
                original_retriever_resource: list[RetrievalSourceMetadata] = []
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

    def _convert_to_original_retriever_resource(self, context_dict: dict):
        if (
            "metadata" in context_dict
            and "_source" in context_dict["metadata"]
            and context_dict["metadata"]["_source"] == "knowledge"
        ):
            metadata = context_dict.get("metadata", {})

            source = RetrievalSourceMetadata(
                position=metadata.get("position"),
                dataset_id=metadata.get("dataset_id"),
                dataset_name=metadata.get("dataset_name"),
                document_id=metadata.get("document_id"),
                document_name=metadata.get("document_name"),
                data_source_type=metadata.get("data_source_type"),
                segment_id=metadata.get("segment_id"),
                retriever_from=metadata.get("retriever_from"),
                score=metadata.get("score"),
                hit_count=metadata.get("segment_hit_count"),
                word_count=metadata.get("segment_word_count"),
                segment_position=metadata.get("segment_position"),
                index_node_hash=metadata.get("segment_index_node_hash"),
                content=context_dict.get("content"),
                page=metadata.get("page"),
                doc_metadata=metadata.get("doc_metadata"),
            )

            return source

        return None

    def _fetch_model_config(
        self, node_data_model: ModelConfig
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        model, model_config_with_cred = llm_utils.fetch_model_config(
            tenant_id=self.tenant_id, node_data_model=node_data_model
        )
        completion_params = model_config_with_cred.parameters

        model_schema = model.model_type_instance.get_model_schema(node_data_model.name, model.credentials)
        if not model_schema:
            raise ModelNotExistError(f"Model {node_data_model.name} not exist.")

        model_config_with_cred.parameters = completion_params
        # NOTE(-LAN-): This line modify the `self.node_data.model`, which is used in `_invoke_llm()`.
        node_data_model.completion_params = completion_params
        return model, model_config_with_cred

    def _fetch_prompt_messages(
        self,
        *,
        sys_query: str | None = None,
        sys_files: Sequence["File"],
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
        prompt_messages: list[PromptMessage] = []

        if isinstance(prompt_template, list):
            # For chat model
            prompt_messages.extend(
                self._handle_list_messages(
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
            if sys_query:
                message = LLMNodeChatModelMessage(
                    text=sys_query,
                    role=PromptMessageRole.USER,
                    edition_type="basic",
                )
                prompt_messages.extend(
                    self._handle_list_messages(
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
                prompt_content = str(prompt_content)
                if "#histories#" in prompt_content:
                    prompt_content = prompt_content.replace("#histories#", memory_text)
                else:
                    prompt_content = memory_text + "\n" + prompt_content
                prompt_messages[0].content = prompt_content
            elif prompt_content_type == list:
                prompt_content = prompt_content if isinstance(prompt_content, list) else []
                for content_item in prompt_content:
                    if content_item.type == PromptMessageContentType.TEXT:
                        if "#histories#" in content_item.data:
                            content_item.data = content_item.data.replace("#histories#", memory_text)
                        else:
                            content_item.data = memory_text + "\n" + content_item.data
            else:
                raise ValueError("Invalid prompt content type")

            # Add current query to the prompt message
            if sys_query:
                if prompt_content_type == str:
                    prompt_content = str(prompt_messages[0].content).replace("#sys.query#", sys_query)
                    prompt_messages[0].content = prompt_content
                elif prompt_content_type == list:
                    prompt_content = prompt_content if isinstance(prompt_content, list) else []
                    for content_item in prompt_content:
                        if content_item.type == PromptMessageContentType.TEXT:
                            content_item.data = sys_query + "\n" + content_item.data
                else:
                    raise ValueError("Invalid prompt content type")
        else:
            raise TemplateTypeNotSupportError(type_name=str(type(prompt_template)))

        # The sys_files will be deprecated later
        if vision_enabled and sys_files:
            file_prompts = []
            for file in sys_files:
                file_prompt = file_manager.to_prompt_message_content(file, image_detail_config=vision_detail)
                file_prompts.append(file_prompt)
            # If last prompt is a user prompt, add files into its contents,
            # otherwise append a new user prompt
            if (
                len(prompt_messages) > 0
                and isinstance(prompt_messages[-1], UserPromptMessage)
                and isinstance(prompt_messages[-1].content, list)
            ):
                prompt_messages[-1] = UserPromptMessage(content=prompt_messages[-1].content + file_prompts)
            else:
                prompt_messages.append(UserPromptMessage(content=file_prompts))

        # Remove empty messages and filter unsupported content
        filtered_prompt_messages = []
        for prompt_message in prompt_messages:
            if isinstance(prompt_message.content, list):
                prompt_message_content: list[PromptMessageContentUnionTypes] = []
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

        model = ModelManager().get_model_instance(
            tenant_id=self.tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.provider,
            model=model_config.model,
        )
        model_schema = model.model_type_instance.get_model_schema(
            model=model_config.model,
            credentials=model.credentials,
        )
        if not model_schema:
            raise ModelNotExistError(f"Model {model_config.model} not exist.")
        return filtered_prompt_messages, model_config.stop

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

        variable_mapping: dict[str, Any] = {}
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
            variable_mapping["#files#"] = node_data.vision.configs.variable_selector

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

    def _handle_list_messages(
        self,
        *,
        messages: Sequence[LLMNodeChatModelMessage],
        context: Optional[str],
        jinja2_variables: Sequence[VariableSelector],
        variable_pool: VariablePool,
        vision_detail_config: ImagePromptMessageContent.DETAIL,
    ) -> Sequence[PromptMessage]:
        prompt_messages: list[PromptMessage] = []
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
                    elif isinstance(segment, FileSegment):
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

    def _handle_blocking_result(self, *, invoke_result: LLMResult) -> ModelInvokeCompletedEvent:
        buffer = io.StringIO()
        for text_part in self._save_multimodal_output_and_convert_result_to_markdown(invoke_result.message.content):
            buffer.write(text_part)

        return ModelInvokeCompletedEvent(
            text=buffer.getvalue(),
            usage=invoke_result.usage,
            finish_reason=None,
        )

    def _save_multimodal_image_output(self, content: ImagePromptMessageContent) -> "File":
        """_save_multimodal_output saves multi-modal contents generated by LLM plugins.

        There are two kinds of multimodal outputs:

          - Inlined data encoded in base64, which would be saved to storage directly.
          - Remote files referenced by an url, which would be downloaded and then saved to storage.

        Currently, only image files are supported.
        """
        # Inject the saver somehow...
        _saver = self._llm_file_saver

        # If this
        if content.url != "":
            saved_file = _saver.save_remote_url(content.url, FileType.IMAGE)
        else:
            saved_file = _saver.save_binary_string(
                data=base64.b64decode(content.base64_data),
                mime_type=content.mime_type,
                file_type=FileType.IMAGE,
            )
        self._file_outputs.append(saved_file)
        return saved_file

    def _fetch_model_schema(self, provider: str) -> AIModelEntity | None:
        """
        Fetch model schema
        """
        model_name = self.node_data.model.name
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id, model_type=ModelType.LLM, provider=provider, model=model_name
        )
        model_type_instance = model_instance.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)
        model_credentials = model_instance.credentials
        model_schema = model_type_instance.get_model_schema(model_name, model_credentials)
        return model_schema

    def _fetch_structured_output_schema(self) -> dict[str, Any]:
        """
        Fetch the structured output schema from the node data.

        Returns:
            dict[str, Any]: The structured output schema
        """
        if not self.node_data.structured_output:
            raise LLMNodeError("Please provide a valid structured output schema")
        structured_output_schema = json.dumps(self.node_data.structured_output.get("schema", {}), ensure_ascii=False)
        if not structured_output_schema:
            raise LLMNodeError("Please provide a valid structured output schema")

        try:
            schema = json.loads(structured_output_schema)
            if not isinstance(schema, dict):
                raise LLMNodeError("structured_output_schema must be a JSON object")
            return schema
        except json.JSONDecodeError:
            raise LLMNodeError("structured_output_schema is not valid JSON format")

    def _save_multimodal_output_and_convert_result_to_markdown(
        self,
        contents: str | list[PromptMessageContentUnionTypes] | None,
    ) -> Generator[str, None, None]:
        """Convert intermediate prompt messages into strings and yield them to the caller.

        If the messages contain non-textual content (e.g., multimedia like images or videos),
        it will be saved separately, and the corresponding Markdown representation will
        be yielded to the caller.
        """

        # NOTE(QuantumGhost): This function should yield results to the caller immediately
        # whenever new content or partial content is available. Avoid any intermediate buffering
        # of results. Additionally, do not yield empty strings; instead, yield from an empty list
        # if necessary.
        if contents is None:
            yield from []
            return
        if isinstance(contents, str):
            yield contents
        elif isinstance(contents, list):
            for item in contents:
                if isinstance(item, TextPromptMessageContent):
                    yield item.data
                elif isinstance(item, ImagePromptMessageContent):
                    file = self._save_multimodal_image_output(item)
                    self._file_outputs.append(file)
                    yield self._image_file_to_markdown(file)
                else:
                    logger.warning("unknown item type encountered, type=%s", type(item))
                    yield str(item)
        else:
            logger.warning("unknown contents type encountered, type=%s", type(contents))
            yield str(contents)


def _combine_message_content_with_role(
    *, contents: Optional[str | list[PromptMessageContentUnionTypes]] = None, role: PromptMessageRole
):
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
    memory_messages: Sequence[PromptMessage] = []
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
