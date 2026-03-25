from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import select

from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.model_manager import ModelInstance
from core.prompt.entities.advanced_prompt_entities import CompletionModelPromptTemplate, MemoryConfig
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.tools.signature import sign_upload_file
from dify_graph.constants import SYSTEM_VARIABLE_NODE_ID
from dify_graph.entities import GraphInitParams
from dify_graph.entities.graph_config import NodeConfigDict
from dify_graph.enums import (
    BuiltinNodeTypes,
    NodeType,
    SystemVariableKey,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from dify_graph.file import File, FileTransferMethod, FileType
from dify_graph.model_runtime.entities import (
    ImagePromptMessageContent,
    PromptMessage,
    TextPromptMessageContent,
)
from dify_graph.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
    LLMStructuredOutput,
    LLMUsage,
)
from dify_graph.model_runtime.entities.message_entities import PromptMessageContentUnionTypes
from dify_graph.model_runtime.memory import PromptMessageMemory
from dify_graph.model_runtime.utils.encoders import jsonable_encoder
from dify_graph.node_events import (
    ModelInvokeCompletedEvent,
    NodeEventBase,
    NodeRunResult,
    RunRetrieverResourceEvent,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from dify_graph.nodes.base.entities import VariableSelector
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.base.variable_template_parser import VariableTemplateParser
from dify_graph.nodes.llm.protocols import CredentialsProvider, ModelFactory, TemplateRenderer
from dify_graph.nodes.protocols import HttpClientProtocol
from dify_graph.runtime import VariablePool
from dify_graph.variables import (
    ArrayFileSegment,
    ArraySegment,
    NoneSegment,
    ObjectSegment,
    StringSegment,
)
from extensions.ext_database import db
from models.dataset import SegmentAttachmentBinding
from models.model import UploadFile

from . import llm_utils
from .entities import (
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    LLMNodeData,
)
from .exc import (
    InvalidContextStructureError,
    InvalidVariableTypeError,
    LLMNodeError,
    VariableNotFoundError,
)
from .file_saver import FileSaverImpl, LLMFileSaver

if TYPE_CHECKING:
    from dify_graph.file.models import File
    from dify_graph.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)


class LLMNode(Node[LLMNodeData]):
    node_type = BuiltinNodeTypes.LLM

    # Compiled regex for extracting <think> blocks (with compatibility for attributes)
    _THINK_PATTERN = re.compile(r"<think[^>]*>(.*?)</think>", re.IGNORECASE | re.DOTALL)

    # Instance attributes specific to LLMNode.
    # Output variable for file
    _file_outputs: list[File]

    _llm_file_saver: LLMFileSaver
    _credentials_provider: CredentialsProvider
    _model_factory: ModelFactory
    _model_instance: ModelInstance
    _memory: PromptMessageMemory | None
    _template_renderer: TemplateRenderer

    def __init__(
        self,
        id: str,
        config: NodeConfigDict,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        *,
        credentials_provider: CredentialsProvider,
        model_factory: ModelFactory,
        model_instance: ModelInstance,
        http_client: HttpClientProtocol,
        template_renderer: TemplateRenderer,
        memory: PromptMessageMemory | None = None,
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

        self._credentials_provider = credentials_provider
        self._model_factory = model_factory
        self._model_instance = model_instance
        self._memory = memory
        self._template_renderer = template_renderer

        if llm_file_saver is None:
            dify_ctx = self.require_dify_context()
            llm_file_saver = FileSaverImpl(
                user_id=dify_ctx.user_id,
                tenant_id=dify_ctx.tenant_id,
                http_client=http_client,
            )
        self._llm_file_saver = llm_file_saver

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator:
        node_inputs: dict[str, Any] = {}
        process_data: dict[str, Any] = {}
        result_text = ""
        clean_text = ""
        usage = LLMUsage.empty_usage()
        finish_reason = None
        reasoning_content = None
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
            context_files: list[File] = []
            for event in generator:
                context = event.context
                context_files = event.context_files or []
                yield event
            if context:
                node_inputs["#context#"] = context

            if context_files:
                node_inputs["#context_files#"] = [file.model_dump() for file in context_files]

            # fetch model config
            model_instance = self._model_instance
            # Resolve variable references in string-typed completion params
            model_instance.parameters = llm_utils.resolve_completion_params_variables(
                model_instance.parameters, variable_pool
            )
            model_name = model_instance.model_name
            model_provider = model_instance.provider
            model_stop = model_instance.stop

            memory = self._memory

            query: str | None = None
            if self.node_data.memory:
                query = self.node_data.memory.query_prompt_template
                if not query and (
                    query_variable := variable_pool.get((SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.QUERY))
                ):
                    query = query_variable.text

            prompt_messages, stop = LLMNode.fetch_prompt_messages(
                sys_query=query,
                sys_files=files,
                context=context,
                memory=memory,
                model_instance=model_instance,
                stop=model_stop,
                prompt_template=self.node_data.prompt_template,
                memory_config=self.node_data.memory,
                vision_enabled=self.node_data.vision.enabled,
                vision_detail=self.node_data.vision.configs.detail,
                variable_pool=variable_pool,
                jinja2_variables=self.node_data.prompt_config.jinja2_variables,
                context_files=context_files,
                template_renderer=self._template_renderer,
            )

            # handle invoke result
            generator = LLMNode.invoke_llm(
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                stop=stop,
                user_id=self.require_dify_context().user_id,
                structured_output_enabled=self.node_data.structured_output_enabled,
                structured_output=self.node_data.structured_output,
                file_saver=self._llm_file_saver,
                file_outputs=self._file_outputs,
                node_id=self._node_id,
                node_type=self.node_type,
                reasoning_format=self.node_data.reasoning_format,
            )

            structured_output: LLMStructuredOutput | None = None

            for event in generator:
                if isinstance(event, StreamChunkEvent):
                    yield event
                elif isinstance(event, ModelInvokeCompletedEvent):
                    # Raw text
                    result_text = event.text
                    usage = event.usage
                    finish_reason = event.finish_reason
                    reasoning_content = event.reasoning_content or ""

                    # For downstream nodes, determine clean text based on reasoning_format
                    if self.node_data.reasoning_format == "tagged":
                        # Keep <think> tags for backward compatibility
                        clean_text = result_text
                    else:
                        # Extract clean text from <think> tags
                        clean_text, _ = LLMNode._split_reasoning(result_text, self.node_data.reasoning_format)

                    # Process structured output if available from the event.
                    structured_output = (
                        LLMStructuredOutput(structured_output=event.structured_output)
                        if event.structured_output
                        else None
                    )

                    break
                elif isinstance(event, LLMStructuredOutput):
                    structured_output = event

            process_data = {
                "model_mode": self.node_data.model.mode,
                "prompts": PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                    model_mode=self.node_data.model.mode, prompt_messages=prompt_messages
                ),
                "usage": jsonable_encoder(usage),
                "finish_reason": finish_reason,
                "model_provider": model_provider,
                "model_name": model_name,
            }

            outputs = {
                "text": clean_text,
                "reasoning_content": reasoning_content,
                "usage": jsonable_encoder(usage),
                "finish_reason": finish_reason,
            }
            if structured_output:
                outputs["structured_output"] = structured_output.structured_output
            if self._file_outputs:
                outputs["files"] = ArrayFileSegment(value=self._file_outputs)

            # Send final chunk event to indicate streaming is complete
            yield StreamChunkEvent(
                selector=[self._node_id, "text"],
                chunk="",
                is_final=True,
            )

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
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
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    inputs=node_inputs,
                    process_data=process_data,
                    error_type=type(e).__name__,
                    llm_usage=usage,
                )
            )
        except Exception as e:
            logger.exception("error while executing llm node")
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    inputs=node_inputs,
                    process_data=process_data,
                    error_type=type(e).__name__,
                    llm_usage=usage,
                )
            )

    @staticmethod
    def invoke_llm(
        *,
        model_instance: ModelInstance,
        prompt_messages: Sequence[PromptMessage],
        stop: Sequence[str] | None = None,
        user_id: str,
        structured_output_enabled: bool,
        structured_output: Mapping[str, Any] | None = None,
        file_saver: LLMFileSaver,
        file_outputs: list[File],
        node_id: str,
        node_type: NodeType,
        reasoning_format: Literal["separated", "tagged"] = "tagged",
    ) -> Generator[NodeEventBase | LLMStructuredOutput, None, None]:
        model_parameters = model_instance.parameters
        invoke_model_parameters = dict(model_parameters)

        model_schema = llm_utils.fetch_model_schema(model_instance=model_instance)

        if structured_output_enabled:
            output_schema = LLMNode.fetch_structured_output_schema(
                structured_output=structured_output or {},
            )
            request_start_time = time.perf_counter()

            invoke_result = invoke_llm_with_structured_output(
                provider=model_instance.provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                json_schema=output_schema,
                model_parameters=invoke_model_parameters,
                stop=list(stop or []),
                stream=True,
                user=user_id,
            )
        else:
            request_start_time = time.perf_counter()

            invoke_result = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages),
                model_parameters=invoke_model_parameters,
                stop=list(stop or []),
                stream=True,
                user=user_id,
            )

        return LLMNode.handle_invoke_result(
            invoke_result=invoke_result,
            file_saver=file_saver,
            file_outputs=file_outputs,
            node_id=node_id,
            node_type=node_type,
            reasoning_format=reasoning_format,
            request_start_time=request_start_time,
        )

    @staticmethod
    def handle_invoke_result(
        *,
        invoke_result: LLMResult | Generator[LLMResultChunk | LLMStructuredOutput, None, None],
        file_saver: LLMFileSaver,
        file_outputs: list[File],
        node_id: str,
        node_type: NodeType,
        reasoning_format: Literal["separated", "tagged"] = "tagged",
        request_start_time: float | None = None,
    ) -> Generator[NodeEventBase | LLMStructuredOutput, None, None]:
        # For blocking mode
        if isinstance(invoke_result, LLMResult):
            duration = None
            if request_start_time is not None:
                duration = time.perf_counter() - request_start_time
                invoke_result.usage.latency = round(duration, 3)
            event = LLMNode.handle_blocking_result(
                invoke_result=invoke_result,
                saver=file_saver,
                file_outputs=file_outputs,
                reasoning_format=reasoning_format,
                request_latency=duration,
            )
            yield event
            return

        # For streaming mode
        model = ""
        prompt_messages: list[PromptMessage] = []

        usage = LLMUsage.empty_usage()
        finish_reason = None
        full_text_buffer = io.StringIO()

        # Initialize streaming metrics tracking
        start_time = request_start_time if request_start_time is not None else time.perf_counter()
        first_token_time = None
        has_content = False

        collected_structured_output = None  # Collect structured_output from streaming chunks
        # Consume the invoke result and handle generator exception
        try:
            for result in invoke_result:
                if isinstance(result, LLMResultChunkWithStructuredOutput):
                    # Collect structured_output from the chunk
                    if result.structured_output is not None:
                        collected_structured_output = dict(result.structured_output)
                    yield result
                if isinstance(result, LLMResultChunk):
                    contents = result.delta.message.content
                    for text_part in LLMNode._save_multimodal_output_and_convert_result_to_markdown(
                        contents=contents,
                        file_saver=file_saver,
                        file_outputs=file_outputs,
                    ):
                        # Detect first token for TTFT calculation
                        if text_part and not has_content:
                            first_token_time = time.perf_counter()
                            has_content = True

                        full_text_buffer.write(text_part)
                        yield StreamChunkEvent(
                            selector=[node_id, "text"],
                            chunk=text_part,
                            is_final=False,
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

        # Extract reasoning content from <think> tags in the main text
        full_text = full_text_buffer.getvalue()

        if reasoning_format == "tagged":
            # Keep <think> tags in text for backward compatibility
            clean_text = full_text
            reasoning_content = ""
        else:
            # Extract clean text and reasoning from <think> tags
            clean_text, reasoning_content = LLMNode._split_reasoning(full_text, reasoning_format)

        # Calculate streaming metrics
        end_time = time.perf_counter()
        total_duration = end_time - start_time
        usage.latency = round(total_duration, 3)
        if has_content and first_token_time:
            gen_ai_server_time_to_first_token = first_token_time - start_time
            llm_streaming_time_to_generate = end_time - first_token_time
            usage.time_to_first_token = round(gen_ai_server_time_to_first_token, 3)
            usage.time_to_generate = round(llm_streaming_time_to_generate, 3)

        yield ModelInvokeCompletedEvent(
            # Use clean_text for separated mode, full_text for tagged mode
            text=clean_text if reasoning_format == "separated" else full_text,
            usage=usage,
            finish_reason=finish_reason,
            # Reasoning content for workflow variables and downstream nodes
            reasoning_content=reasoning_content,
            # Pass structured output if collected from streaming chunks
            structured_output=collected_structured_output,
        )

    @staticmethod
    def _image_file_to_markdown(file: File, /):
        text_chunk = f"![]({file.generate_url()})"
        return text_chunk

    @classmethod
    def _split_reasoning(
        cls, text: str, reasoning_format: Literal["separated", "tagged"] = "tagged"
    ) -> tuple[str, str]:
        """
        Split reasoning content from text based on reasoning_format strategy.

        Args:
            text: Full text that may contain <think> blocks
            reasoning_format: Strategy for handling reasoning content
                - "separated": Remove <think> tags and return clean text + reasoning_content field
                - "tagged": Keep <think> tags in text, return empty reasoning_content

        Returns:
            tuple of (clean_text, reasoning_content)
        """

        if reasoning_format == "tagged":
            return text, ""

        # Find all <think>...</think> blocks (case-insensitive)
        matches = cls._THINK_PATTERN.findall(text)

        # Extract reasoning content from all <think> blocks
        reasoning_content = "\n".join(match.strip() for match in matches) if matches else ""

        # Remove all <think>...</think> blocks from original text
        clean_text = cls._THINK_PATTERN.sub("", text)

        # Clean up extra whitespace
        clean_text = re.sub(r"\n\s*\n", "\n\n", clean_text).strip()

        # Separated mode: always return clean text and reasoning_content
        return clean_text, reasoning_content or ""

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
                yield RunRetrieverResourceEvent(
                    retriever_resources=[], context=context_value_variable.value, context_files=[]
                )
            elif isinstance(context_value_variable, ArraySegment):
                context_str = ""
                original_retriever_resource: list[dict[str, Any]] = []
                context_files: list[File] = []
                for item in context_value_variable.value:
                    if isinstance(item, str):
                        context_str += item + "\n"
                    else:
                        if "content" not in item:
                            raise InvalidContextStructureError(f"Invalid context structure: {item}")

                        if item.get("summary"):
                            context_str += item["summary"] + "\n"
                        context_str += item["content"] + "\n"

                        retriever_resource = self._convert_to_original_retriever_resource(item)
                        if retriever_resource:
                            original_retriever_resource.append(retriever_resource)
                            segment_id = retriever_resource.get("segment_id")
                            if not segment_id:
                                continue
                            attachments_with_bindings = db.session.execute(
                                select(SegmentAttachmentBinding, UploadFile)
                                .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                                .where(
                                    SegmentAttachmentBinding.segment_id == segment_id,
                                )
                            ).all()
                            if attachments_with_bindings:
                                for _, upload_file in attachments_with_bindings:
                                    attachment_info = File(
                                        id=upload_file.id,
                                        filename=upload_file.name,
                                        extension="." + upload_file.extension,
                                        mime_type=upload_file.mime_type,
                                        tenant_id=self.require_dify_context().tenant_id,
                                        type=FileType.IMAGE,
                                        transfer_method=FileTransferMethod.LOCAL_FILE,
                                        remote_url=upload_file.source_url,
                                        related_id=upload_file.id,
                                        size=upload_file.size,
                                        storage_key=upload_file.key,
                                        url=sign_upload_file(upload_file.id, upload_file.extension),
                                    )
                                    context_files.append(attachment_info)
                yield RunRetrieverResourceEvent(
                    retriever_resources=original_retriever_resource,
                    context=context_str.strip(),
                    context_files=context_files,
                )

    def _convert_to_original_retriever_resource(self, context_dict: dict) -> dict[str, Any] | None:
        if (
            "metadata" in context_dict
            and "_source" in context_dict["metadata"]
            and context_dict["metadata"]["_source"] == "knowledge"
        ):
            metadata = context_dict.get("metadata", {})

            return {
                "position": metadata.get("position"),
                "dataset_id": metadata.get("dataset_id"),
                "dataset_name": metadata.get("dataset_name"),
                "document_id": metadata.get("document_id"),
                "document_name": metadata.get("document_name"),
                "data_source_type": metadata.get("data_source_type"),
                "segment_id": metadata.get("segment_id"),
                "retriever_from": metadata.get("retriever_from"),
                "score": metadata.get("score"),
                "hit_count": metadata.get("segment_hit_count"),
                "word_count": metadata.get("segment_word_count"),
                "segment_position": metadata.get("segment_position"),
                "index_node_hash": metadata.get("segment_index_node_hash"),
                "content": context_dict.get("content"),
                "page": metadata.get("page"),
                "doc_metadata": metadata.get("doc_metadata"),
                "files": context_dict.get("files"),
                "summary": context_dict.get("summary"),
            }

        return None

    @staticmethod
    def fetch_prompt_messages(
        *,
        sys_query: str | None = None,
        sys_files: Sequence[File],
        context: str | None = None,
        memory: PromptMessageMemory | None = None,
        model_instance: ModelInstance,
        prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate,
        stop: Sequence[str] | None = None,
        memory_config: MemoryConfig | None = None,
        vision_enabled: bool = False,
        vision_detail: ImagePromptMessageContent.DETAIL,
        variable_pool: VariablePool,
        jinja2_variables: Sequence[VariableSelector],
        context_files: list[File] | None = None,
        template_renderer: TemplateRenderer | None = None,
    ) -> tuple[Sequence[PromptMessage], Sequence[str] | None]:
        return llm_utils.fetch_prompt_messages(
            sys_query=sys_query,
            sys_files=sys_files,
            context=context,
            memory=memory,
            model_instance=model_instance,
            prompt_template=prompt_template,
            stop=stop,
            memory_config=memory_config,
            vision_enabled=vision_enabled,
            vision_detail=vision_detail,
            variable_pool=variable_pool,
            jinja2_variables=jinja2_variables,
            context_files=context_files,
            template_renderer=template_renderer,
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: LLMNodeData,
    ) -> Mapping[str, Sequence[str]]:
        # graph_config is not used in this node type
        _ = graph_config  # Explicitly mark as unused
        prompt_template = node_data.prompt_template
        variable_selectors = []
        if isinstance(prompt_template, list):
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
            variable_mapping["#sys.query#"] = ["sys", SystemVariableKey.QUERY]

        if node_data.prompt_config:
            enable_jinja = False

            if isinstance(prompt_template, LLMNodeCompletionModelPromptTemplate):
                if prompt_template.edition_type == "jinja2":
                    enable_jinja = True
            else:
                for prompt in prompt_template:
                    if prompt.edition_type == "jinja2":
                        enable_jinja = True
                        break

            if enable_jinja:
                for variable_selector in node_data.prompt_config.jinja2_variables or []:
                    variable_mapping[variable_selector.variable] = variable_selector.value_selector

        variable_mapping = {node_id + "." + key: value for key, value in variable_mapping.items()}

        return variable_mapping

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
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

    @staticmethod
    def handle_list_messages(
        *,
        messages: Sequence[LLMNodeChatModelMessage],
        context: str | None,
        jinja2_variables: Sequence[VariableSelector],
        variable_pool: VariablePool,
        vision_detail_config: ImagePromptMessageContent.DETAIL,
        template_renderer: TemplateRenderer | None = None,
    ) -> Sequence[PromptMessage]:
        return llm_utils.handle_list_messages(
            messages=messages,
            context=context,
            jinja2_variables=jinja2_variables,
            variable_pool=variable_pool,
            vision_detail_config=vision_detail_config,
            template_renderer=template_renderer,
        )

    @staticmethod
    def handle_blocking_result(
        *,
        invoke_result: LLMResult | LLMResultWithStructuredOutput,
        saver: LLMFileSaver,
        file_outputs: list[File],
        reasoning_format: Literal["separated", "tagged"] = "tagged",
        request_latency: float | None = None,
    ) -> ModelInvokeCompletedEvent:
        buffer = io.StringIO()
        for text_part in LLMNode._save_multimodal_output_and_convert_result_to_markdown(
            contents=invoke_result.message.content,
            file_saver=saver,
            file_outputs=file_outputs,
        ):
            buffer.write(text_part)

        # Extract reasoning content from <think> tags in the main text
        full_text = buffer.getvalue()

        if reasoning_format == "tagged":
            # Keep <think> tags in text for backward compatibility
            clean_text = full_text
            reasoning_content = ""
        else:
            # Extract clean text and reasoning from <think> tags
            clean_text, reasoning_content = LLMNode._split_reasoning(full_text, reasoning_format)

        event = ModelInvokeCompletedEvent(
            # Use clean_text for separated mode, full_text for tagged mode
            text=clean_text if reasoning_format == "separated" else full_text,
            usage=invoke_result.usage,
            finish_reason=None,
            # Reasoning content for workflow variables and downstream nodes
            reasoning_content=reasoning_content,
            # Pass structured output if enabled
            structured_output=getattr(invoke_result, "structured_output", None),
        )
        if request_latency is not None:
            event.usage.latency = round(request_latency, 3)
        return event

    @staticmethod
    def save_multimodal_image_output(
        *,
        content: ImagePromptMessageContent,
        file_saver: LLMFileSaver,
    ) -> File:
        """_save_multimodal_output saves multi-modal contents generated by LLM plugins.

        There are two kinds of multimodal outputs:

          - Inlined data encoded in base64, which would be saved to storage directly.
          - Remote files referenced by an url, which would be downloaded and then saved to storage.

        Currently, only image files are supported.
        """
        if content.url != "":
            saved_file = file_saver.save_remote_url(content.url, FileType.IMAGE)
        else:
            saved_file = file_saver.save_binary_string(
                data=base64.b64decode(content.base64_data),
                mime_type=content.mime_type,
                file_type=FileType.IMAGE,
            )
        return saved_file

    @staticmethod
    def fetch_structured_output_schema(
        *,
        structured_output: Mapping[str, Any],
    ) -> dict[str, Any]:
        """
        Fetch the structured output schema from the node data.

        Returns:
            dict[str, Any]: The structured output schema
        """
        if not structured_output:
            raise LLMNodeError("Please provide a valid structured output schema")
        structured_output_schema = json.dumps(structured_output.get("schema", {}), ensure_ascii=False)
        if not structured_output_schema:
            raise LLMNodeError("Please provide a valid structured output schema")

        try:
            schema = json.loads(structured_output_schema)
            if not isinstance(schema, dict):
                raise LLMNodeError("structured_output_schema must be a JSON object")
            return schema
        except json.JSONDecodeError:
            raise LLMNodeError("structured_output_schema is not valid JSON format")

    @staticmethod
    def _save_multimodal_output_and_convert_result_to_markdown(
        *,
        contents: str | list[PromptMessageContentUnionTypes] | None,
        file_saver: LLMFileSaver,
        file_outputs: list[File],
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
        else:
            for item in contents:
                if isinstance(item, TextPromptMessageContent):
                    yield item.data
                elif isinstance(item, ImagePromptMessageContent):
                    file = LLMNode.save_multimodal_image_output(
                        content=item,
                        file_saver=file_saver,
                    )
                    file_outputs.append(file)
                    yield LLMNode._image_file_to_markdown(file)
                else:
                    logger.warning("unknown item type encountered, type=%s", type(item))
                    yield str(item)

    @property
    def retry(self) -> bool:
        return self.node_data.retry_config.retry_enabled

    @property
    def model_instance(self) -> ModelInstance:
        return self._model_instance
