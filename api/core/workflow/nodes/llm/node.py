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

from core.agent.entities import AgentLog, AgentResult, AgentToolEntity, ExecutionContext
from core.agent.patterns import StrategyFactory
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.file import File, FileTransferMethod, FileType, file_manager
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
    LLMResultWithStructuredOutput,
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
    ModelFeature,
    ModelPropertyKey,
    ModelType,
)
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.entities.advanced_prompt_entities import CompletionModelPromptTemplate, MemoryConfig
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.sandbox import SandboxSession
from core.tools.__base.tool import Tool
from core.tools.signature import sign_upload_file
from core.tools.tool_manager import ToolManager
from core.variables import (
    ArrayFileSegment,
    ArraySegment,
    FileSegment,
    NoneSegment,
    ObjectSegment,
    StringSegment,
)
from core.virtual_environment.sandbox_manager import SandboxManager
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities import GraphInitParams, ToolCall, ToolResult, ToolResultStatus
from core.workflow.entities.tool_entities import ToolCallResult
from core.workflow.enums import (
    NodeType,
    SystemVariableKey,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.node_events import (
    AgentLogEvent,
    ModelInvokeCompletedEvent,
    NodeEventBase,
    NodeRunResult,
    RunRetrieverResourceEvent,
    StreamChunkEvent,
    StreamCompletedEvent,
    ThoughtChunkEvent,
    ToolCallChunkEvent,
    ToolResultChunkEvent,
)
from core.workflow.node_events.node import ThoughtEndChunkEvent, ThoughtStartChunkEvent
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from models.dataset import SegmentAttachmentBinding
from models.model import UploadFile

from . import llm_utils
from .entities import (
    AgentContext,
    AggregatedResult,
    LLMGenerationData,
    LLMNodeChatModelMessage,
    LLMNodeCompletionModelPromptTemplate,
    LLMNodeData,
    LLMTraceSegment,
    ModelConfig,
    ModelTraceSegment,
    StreamBuffers,
    ThinkTagStreamParser,
    ToolLogPayload,
    ToolOutputState,
    ToolTraceSegment,
    TraceState,
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
    from core.workflow.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)


class LLMNode(Node[LLMNodeData]):
    node_type = NodeType.LLM

    # Compiled regex for extracting <think> blocks (with compatibility for attributes)
    _THINK_PATTERN = re.compile(r"<think[^>]*>(.*?)</think>", re.IGNORECASE | re.DOTALL)

    # Instance attributes specific to LLMNode.
    # Output variable for file
    _file_outputs: list[File]

    _llm_file_saver: LLMFileSaver

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
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

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator:
        node_inputs: dict[str, Any] = {}
        process_data: dict[str, Any] = {}
        clean_text = ""
        usage = LLMUsage.empty_usage()
        finish_reason = None
        reasoning_content = ""  # Initialize as empty string for consistency
        clean_text = ""  # Initialize clean_text to avoid UnboundLocalError
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
            model_instance, model_config = LLMNode._fetch_model_config(
                node_data_model=self.node_data.model,
                tenant_id=self.tenant_id,
            )

            # fetch memory
            memory = llm_utils.fetch_memory(
                variable_pool=variable_pool,
                app_id=self.app_id,
                node_data_memory=self.node_data.memory,
                model_instance=model_instance,
            )

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
                model_config=model_config,
                prompt_template=self.node_data.prompt_template,
                memory_config=self.node_data.memory,
                vision_enabled=self.node_data.vision.enabled,
                vision_detail=self.node_data.vision.configs.detail,
                variable_pool=variable_pool,
                jinja2_variables=self.node_data.prompt_config.jinja2_variables,
                tenant_id=self.tenant_id,
                context_files=context_files,
            )

            # Variables for outputs
            generation_data: LLMGenerationData | None = None
            structured_output: LLMStructuredOutput | None = None

            if self.tool_call_enabled:
                workflow_execution_id = variable_pool.system_variables.workflow_execution_id
                is_sandbox_runtime = workflow_execution_id is not None and SandboxManager.is_sandbox_runtime(
                    workflow_execution_id
                )

                if is_sandbox_runtime:
                    generator = self._invoke_llm_with_sandbox(
                        model_instance=model_instance,
                        prompt_messages=prompt_messages,
                        stop=stop,
                        variable_pool=variable_pool,
                    )
                else:
                    generator = self._invoke_llm_with_tools(
                        model_instance=model_instance,
                        prompt_messages=prompt_messages,
                        stop=stop,
                        files=files,
                        variable_pool=variable_pool,
                        node_inputs=node_inputs,
                        process_data=process_data,
                    )
            else:
                # Use traditional LLM invocation
                generator = LLMNode.invoke_llm(
                    node_data_model=self._node_data.model,
                    model_instance=model_instance,
                    prompt_messages=prompt_messages,
                    stop=stop,
                    user_id=self.user_id,
                    structured_output_enabled=self._node_data.structured_output_enabled,
                    structured_output=self._node_data.structured_output,
                    file_saver=self._llm_file_saver,
                    file_outputs=self._file_outputs,
                    node_id=self._node_id,
                    node_type=self.node_type,
                    reasoning_format=self._node_data.reasoning_format,
                )

            (
                clean_text,
                reasoning_content,
                generation_reasoning_content,
                generation_clean_content,
                usage,
                finish_reason,
                structured_output,
                generation_data,
            ) = yield from self._stream_llm_events(generator, model_instance=model_instance)

            # Extract variables from generation_data if available
            if generation_data:
                clean_text = generation_data.text
                reasoning_content = ""
                usage = generation_data.usage
                finish_reason = generation_data.finish_reason

            # Unified process_data building
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
            if self.tool_call_enabled and self._node_data.tools:
                process_data["tools"] = [
                    {
                        "type": tool.type.value if hasattr(tool.type, "value") else tool.type,
                        "provider_name": tool.provider_name,
                        "tool_name": tool.tool_name,
                    }
                    for tool in self._node_data.tools
                    if tool.enabled
                ]

            # Unified outputs building
            outputs = {
                "text": clean_text,
                "reasoning_content": reasoning_content,
                "usage": jsonable_encoder(usage),
                "finish_reason": finish_reason,
            }

            # Build generation field
            if generation_data:
                # Use generation_data from tool invocation (supports multi-turn)
                generation = {
                    "content": generation_data.text,
                    "reasoning_content": generation_data.reasoning_contents,  # [thought1, thought2, ...]
                    "tool_calls": [self._serialize_tool_call(item) for item in generation_data.tool_calls],
                    "sequence": generation_data.sequence,
                }
                files_to_output = generation_data.files
            else:
                # Traditional LLM invocation
                generation_reasoning = generation_reasoning_content or reasoning_content
                generation_content = generation_clean_content or clean_text
                sequence: list[dict[str, Any]] = []
                if generation_reasoning:
                    sequence = [
                        {"type": "reasoning", "index": 0},
                        {"type": "content", "start": 0, "end": len(generation_content)},
                    ]
                generation = {
                    "content": generation_content,
                    "reasoning_content": [generation_reasoning] if generation_reasoning else [],
                    "tool_calls": [],
                    "sequence": sequence,
                }
                files_to_output = self._file_outputs

            outputs["generation"] = generation
            if files_to_output:
                outputs["files"] = ArrayFileSegment(value=files_to_output)
            if structured_output:
                outputs["structured_output"] = structured_output.structured_output

            # Send final chunk event to indicate streaming is complete
            if not self.tool_call_enabled:
                # For tool calls, final events are already sent in _process_tool_outputs
                yield StreamChunkEvent(
                    selector=[self._node_id, "text"],
                    chunk="",
                    is_final=True,
                )
                yield StreamChunkEvent(
                    selector=[self._node_id, "generation", "content"],
                    chunk="",
                    is_final=True,
                )
                yield ThoughtChunkEvent(
                    selector=[self._node_id, "generation", "thought"],
                    chunk="",
                    is_final=True,
                )

            metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = {
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: usage.total_price,
                WorkflowNodeExecutionMetadataKey.CURRENCY: usage.currency,
            }

            if generation_data and generation_data.trace:
                metadata[WorkflowNodeExecutionMetadataKey.LLM_TRACE] = [
                    segment.model_dump() for segment in generation_data.trace
                ]

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=node_inputs,
                    process_data=process_data,
                    outputs=outputs,
                    metadata=metadata,
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
        node_data_model: ModelConfig,
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
        model_schema = model_instance.model_type_instance.get_model_schema(
            node_data_model.name, model_instance.credentials
        )
        if not model_schema:
            raise ValueError(f"Model schema not found for {node_data_model.name}")

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
                model_parameters=node_data_model.completion_params,
                stop=list(stop or []),
                stream=True,
                user=user_id,
            )
        else:
            request_start_time = time.perf_counter()

            invoke_result = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages),
                model_parameters=node_data_model.completion_params,
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
        think_parser = ThinkTagStreamParser()
        reasoning_chunks: list[str] = []

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
                        # Text output: always forward raw chunk (keep <think> tags intact)
                        yield StreamChunkEvent(
                            selector=[node_id, "text"],
                            chunk=text_part,
                            is_final=False,
                        )

                        # Generation output: split out thoughts, forward only non-thought content chunks
                        for kind, segment in think_parser.process(text_part):
                            if not segment:
                                if kind not in {"thought_start", "thought_end"}:
                                    continue

                            if kind == "thought_start":
                                yield ThoughtStartChunkEvent(
                                    selector=[node_id, "generation", "thought"],
                                    chunk="",
                                    is_final=False,
                                )
                            elif kind == "thought":
                                reasoning_chunks.append(segment)
                                yield ThoughtChunkEvent(
                                    selector=[node_id, "generation", "thought"],
                                    chunk=segment,
                                    is_final=False,
                                )
                            elif kind == "thought_end":
                                yield ThoughtEndChunkEvent(
                                    selector=[node_id, "generation", "thought"],
                                    chunk="",
                                    is_final=False,
                                )
                            else:
                                yield StreamChunkEvent(
                                    selector=[node_id, "generation", "content"],
                                    chunk=segment,
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

        for kind, segment in think_parser.flush():
            if not segment and kind not in {"thought_start", "thought_end"}:
                continue
            if kind == "thought_start":
                yield ThoughtStartChunkEvent(
                    selector=[node_id, "generation", "thought"],
                    chunk="",
                    is_final=False,
                )
            elif kind == "thought":
                reasoning_chunks.append(segment)
                yield ThoughtChunkEvent(
                    selector=[node_id, "generation", "thought"],
                    chunk=segment,
                    is_final=False,
                )
            elif kind == "thought_end":
                yield ThoughtEndChunkEvent(
                    selector=[node_id, "generation", "thought"],
                    chunk="",
                    is_final=False,
                )
            else:
                yield StreamChunkEvent(
                    selector=[node_id, "generation", "content"],
                    chunk=segment,
                    is_final=False,
                )

        # Extract reasoning content from <think> tags in the main text
        full_text = full_text_buffer.getvalue()

        if reasoning_format == "tagged":
            # Keep <think> tags in text for backward compatibility
            clean_text = full_text
            reasoning_content = "".join(reasoning_chunks)
        else:
            # Extract clean text and reasoning from <think> tags
            clean_text, reasoning_content = LLMNode._split_reasoning(full_text, reasoning_format)
            if reasoning_chunks and not reasoning_content:
                reasoning_content = "".join(reasoning_chunks)

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
                original_retriever_resource: list[RetrievalSourceMetadata] = []
                context_files: list[File] = []
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
                            attachments_with_bindings = db.session.execute(
                                select(SegmentAttachmentBinding, UploadFile)
                                .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                                .where(
                                    SegmentAttachmentBinding.segment_id == retriever_resource.segment_id,
                                )
                            ).all()
                            if attachments_with_bindings:
                                for _, upload_file in attachments_with_bindings:
                                    attachment_info = File(
                                        id=upload_file.id,
                                        filename=upload_file.name,
                                        extension="." + upload_file.extension,
                                        mime_type=upload_file.mime_type,
                                        tenant_id=self.tenant_id,
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

    def _convert_to_original_retriever_resource(self, context_dict: dict) -> RetrievalSourceMetadata | None:
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
                files=context_dict.get("files"),
            )

            return source

        return None

    @staticmethod
    def _fetch_model_config(
        *,
        node_data_model: ModelConfig,
        tenant_id: str,
    ) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        model, model_config_with_cred = llm_utils.fetch_model_config(
            tenant_id=tenant_id, node_data_model=node_data_model
        )
        completion_params = model_config_with_cred.parameters

        model_schema = model.model_type_instance.get_model_schema(node_data_model.name, model.credentials)
        if not model_schema:
            raise ModelNotExistError(f"Model {node_data_model.name} not exist.")

        model_config_with_cred.parameters = completion_params
        # NOTE(-LAN-): This line modify the `self.node_data.model`, which is used in `_invoke_llm()`.
        node_data_model.completion_params = completion_params
        return model, model_config_with_cred

    @staticmethod
    def fetch_prompt_messages(
        *,
        sys_query: str | None = None,
        sys_files: Sequence[File],
        context: str | None = None,
        memory: TokenBufferMemory | None = None,
        model_config: ModelConfigWithCredentialsEntity,
        prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate,
        memory_config: MemoryConfig | None = None,
        vision_enabled: bool = False,
        vision_detail: ImagePromptMessageContent.DETAIL,
        variable_pool: VariablePool,
        jinja2_variables: Sequence[VariableSelector],
        tenant_id: str,
        context_files: list[File] | None = None,
    ) -> tuple[Sequence[PromptMessage], Sequence[str] | None]:
        prompt_messages: list[PromptMessage] = []

        if isinstance(prompt_template, list):
            # For chat model
            prompt_messages.extend(
                LLMNode.handle_list_messages(
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
                    LLMNode.handle_list_messages(
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
                prompt_messages[-1] = UserPromptMessage(content=file_prompts + prompt_messages[-1].content)
            else:
                prompt_messages.append(UserPromptMessage(content=file_prompts))

        # The context_files
        if vision_enabled and context_files:
            file_prompts = []
            for file in context_files:
                file_prompt = file_manager.to_prompt_message_content(file, image_detail_config=vision_detail)
                file_prompts.append(file_prompt)
            # If last prompt is a user prompt, add files into its contents,
            # otherwise append a new user prompt
            if (
                len(prompt_messages) > 0
                and isinstance(prompt_messages[-1], UserPromptMessage)
                and isinstance(prompt_messages[-1].content, list)
            ):
                prompt_messages[-1] = UserPromptMessage(content=file_prompts + prompt_messages[-1].content)
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
            tenant_id=tenant_id,
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
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # graph_config is not used in this node type
        _ = graph_config  # Explicitly mark as unused
        # Create typed NodeData from dict
        typed_node_data = LLMNodeData.model_validate(node_data)

        prompt_template = typed_node_data.prompt_template
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

        memory = typed_node_data.memory
        if memory and memory.query_prompt_template:
            query_variable_selectors = VariableTemplateParser(
                template=memory.query_prompt_template
            ).extract_variable_selectors()
            for variable_selector in query_variable_selectors:
                variable_mapping[variable_selector.variable] = variable_selector.value_selector

        if typed_node_data.context.enabled:
            variable_mapping["#context#"] = typed_node_data.context.variable_selector

        if typed_node_data.vision.enabled:
            variable_mapping["#files#"] = typed_node_data.vision.configs.variable_selector

        if typed_node_data.memory:
            variable_mapping["#sys.query#"] = ["sys", SystemVariableKey.QUERY]

        if typed_node_data.prompt_config:
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
                for variable_selector in typed_node_data.prompt_config.jinja2_variables or []:
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
    ) -> Sequence[PromptMessage]:
        prompt_messages: list[PromptMessage] = []
        for message in messages:
            if message.edition_type == "jinja2":
                result_text = _render_jinja2_message(
                    template=message.jinja2_text or "",
                    jinja2_variables=jinja2_variables,
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
    def tool_call_enabled(self) -> bool:
        return (
            self.node_data.tools is not None
            and len(self.node_data.tools) > 0
            and all(tool.enabled for tool in self.node_data.tools)
        )

    def _stream_llm_events(
        self,
        generator: Generator[NodeEventBase | LLMStructuredOutput, None, LLMGenerationData | None],
        *,
        model_instance: ModelInstance,
    ) -> Generator[
        NodeEventBase,
        None,
        tuple[
            str,
            str,
            str,
            str,
            LLMUsage,
            str | None,
            LLMStructuredOutput | None,
            LLMGenerationData | None,
        ],
    ]:
        """
        Stream events and capture generator return value in one place.
        Uses generator delegation so _run stays concise while still emitting events.
        """
        clean_text = ""
        reasoning_content = ""
        generation_reasoning_content = ""
        generation_clean_content = ""
        usage = LLMUsage.empty_usage()
        finish_reason: str | None = None
        structured_output: LLMStructuredOutput | None = None
        generation_data: LLMGenerationData | None = None
        completed = False

        while True:
            try:
                event = next(generator)
            except StopIteration as exc:
                if isinstance(exc.value, LLMGenerationData):
                    generation_data = exc.value
                break

            if completed:
                # After completion we still drain to reach StopIteration.value
                continue

            match event:
                case StreamChunkEvent() | ThoughtChunkEvent():
                    yield event

                case ModelInvokeCompletedEvent(
                    text=text,
                    usage=usage_event,
                    finish_reason=finish_reason_event,
                    reasoning_content=reasoning_event,
                    structured_output=structured_raw,
                ):
                    clean_text = text
                    usage = usage_event
                    finish_reason = finish_reason_event
                    reasoning_content = reasoning_event or ""
                    generation_reasoning_content = reasoning_content
                    generation_clean_content = clean_text

                    if self.node_data.reasoning_format == "tagged":
                        # Keep tagged text for output; also extract reasoning for generation field
                        generation_clean_content, generation_reasoning_content = LLMNode._split_reasoning(
                            clean_text, reasoning_format="separated"
                        )
                    else:
                        clean_text, generation_reasoning_content = LLMNode._split_reasoning(
                            clean_text, self.node_data.reasoning_format
                        )
                        generation_clean_content = clean_text

                    structured_output = (
                        LLMStructuredOutput(structured_output=structured_raw) if structured_raw else None
                    )

                    llm_utils.deduct_llm_quota(tenant_id=self.tenant_id, model_instance=model_instance, usage=usage)
                    completed = True

                case LLMStructuredOutput():
                    structured_output = event

                case _:
                    continue

        return (
            clean_text,
            reasoning_content,
            generation_reasoning_content,
            generation_clean_content,
            usage,
            finish_reason,
            structured_output,
            generation_data,
        )

    def _invoke_llm_with_tools(
        self,
        model_instance: ModelInstance,
        prompt_messages: Sequence[PromptMessage],
        stop: Sequence[str] | None,
        files: Sequence[File],
        variable_pool: VariablePool,
        node_inputs: dict[str, Any],
        process_data: dict[str, Any],
    ) -> Generator[NodeEventBase, None, LLMGenerationData]:
        """Invoke LLM with tools support (from Agent V2).

        Returns LLMGenerationData with text, reasoning_contents, tool_calls, usage, finish_reason, files
        """
        # Get model features to determine strategy
        model_features = self._get_model_features(model_instance)

        # Prepare tool instances
        tool_instances = self._prepare_tool_instances(variable_pool)

        # Prepare prompt files (files that come from prompt variables, not vision files)
        prompt_files = self._extract_prompt_files(variable_pool)

        # Use factory to create appropriate strategy
        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=model_instance,
            tools=tool_instances,
            files=prompt_files,
            max_iterations=self._node_data.max_iterations or 10,
            context=ExecutionContext(user_id=self.user_id, app_id=self.app_id, tenant_id=self.tenant_id),
        )

        # Run strategy
        outputs = strategy.run(
            prompt_messages=list(prompt_messages),
            model_parameters=self._node_data.model.completion_params,
            stop=list(stop or []),
            stream=True,
        )

        result = yield from self._process_tool_outputs(outputs)
        return result

    def _invoke_llm_with_sandbox(
        self,
        model_instance: ModelInstance,
        prompt_messages: Sequence[PromptMessage],
        stop: Sequence[str] | None,
        variable_pool: VariablePool,
    ) -> Generator[NodeEventBase, None, LLMGenerationData]:
        from core.agent.entities import AgentEntity

        workflow_execution_id = variable_pool.system_variables.workflow_execution_id
        if not workflow_execution_id:
            raise LLMNodeError("workflow_execution_id is required for sandbox runtime mode")

        configured_tools = self._prepare_tool_instances(variable_pool)

        result: LLMGenerationData | None = None

        with SandboxSession(
            workflow_execution_id=workflow_execution_id,
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            tools=configured_tools,
        ) as sandbox_session:
            prompt_files = self._extract_prompt_files(variable_pool)

            strategy = StrategyFactory.create_strategy(
                model_features=[],
                model_instance=model_instance,
                tools=[sandbox_session.bash_tool],
                files=prompt_files,
                max_iterations=self._node_data.max_iterations or 10,
                context=ExecutionContext(user_id=self.user_id, app_id=self.app_id, tenant_id=self.tenant_id),
                agent_strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
            )

            outputs = strategy.run(
                prompt_messages=list(prompt_messages),
                model_parameters=self._node_data.model.completion_params,
                stop=list(stop or []),
                stream=True,
            )

            result = yield from self._process_tool_outputs(outputs)

        if result is None:
            raise LLMNodeError("SandboxSession exited unexpectedly")

        return result

    def _get_model_features(self, model_instance: ModelInstance) -> list[ModelFeature]:
        """Get model schema to determine features."""
        try:
            model_type_instance = model_instance.model_type_instance
            model_schema = model_type_instance.get_model_schema(
                model_instance.model,
                model_instance.credentials,
            )
            return model_schema.features if model_schema and model_schema.features else []
        except Exception:
            logger.warning("Failed to get model schema, assuming no special features")
            return []

    def _prepare_tool_instances(self, variable_pool: VariablePool) -> list[Tool]:
        """Prepare tool instances from configuration."""
        tool_instances = []

        if self._node_data.tools:
            for tool in self._node_data.tools:
                try:
                    # Process settings to extract the correct structure
                    processed_settings = {}
                    for key, value in tool.settings.items():
                        if isinstance(value, dict) and "value" in value and isinstance(value["value"], dict):
                            # Extract the nested value if it has the ToolInput structure
                            if "type" in value["value"] and "value" in value["value"]:
                                processed_settings[key] = value["value"]
                            else:
                                processed_settings[key] = value
                        else:
                            processed_settings[key] = value

                    # Merge parameters with processed settings (similar to Agent Node logic)
                    merged_parameters = {**tool.parameters, **processed_settings}

                    # Create AgentToolEntity from ToolMetadata
                    agent_tool = AgentToolEntity(
                        provider_id=tool.provider_name,
                        provider_type=tool.type,
                        tool_name=tool.tool_name,
                        tool_parameters=merged_parameters,
                        plugin_unique_identifier=tool.plugin_unique_identifier,
                        credential_id=tool.credential_id,
                    )

                    # Get tool runtime from ToolManager
                    tool_runtime = ToolManager.get_agent_tool_runtime(
                        tenant_id=self.tenant_id,
                        app_id=self.app_id,
                        agent_tool=agent_tool,
                        invoke_from=self.invoke_from,
                        variable_pool=variable_pool,
                    )

                    # Apply custom description from extra field if available
                    if tool.extra.get("description") and tool_runtime.entity.description:
                        tool_runtime.entity.description.llm = (
                            tool.extra.get("description") or tool_runtime.entity.description.llm
                        )

                    tool_instances.append(tool_runtime)
                except Exception as e:
                    logger.warning("Failed to load tool %s: %s", tool, str(e))
                    continue

        return tool_instances

    def _extract_prompt_files(self, variable_pool: VariablePool) -> list[File]:
        """Extract files from prompt template variables."""
        from core.variables import ArrayFileVariable, FileVariable

        files: list[File] = []

        # Extract variables from prompt template
        if isinstance(self._node_data.prompt_template, list):
            for message in self._node_data.prompt_template:
                if message.text:
                    parser = VariableTemplateParser(message.text)
                    variable_selectors = parser.extract_variable_selectors()

                    for variable_selector in variable_selectors:
                        variable = variable_pool.get(variable_selector.value_selector)
                        if isinstance(variable, FileVariable) and variable.value:
                            files.append(variable.value)
                        elif isinstance(variable, ArrayFileVariable) and variable.value:
                            files.extend(variable.value)

        return files

    @staticmethod
    def _serialize_tool_call(tool_call: ToolCallResult) -> dict[str, Any]:
        """Convert ToolCallResult into JSON-friendly dict."""

        def _file_to_ref(file: File) -> str | None:
            # Align with streamed tool result events which carry file IDs
            return file.id or file.related_id

        files = []
        for file in tool_call.files or []:
            ref = _file_to_ref(file)
            if ref:
                files.append(ref)

        return {
            "id": tool_call.id,
            "name": tool_call.name,
            "arguments": tool_call.arguments,
            "output": tool_call.output,
            "files": files,
            "status": tool_call.status.value if hasattr(tool_call.status, "value") else tool_call.status,
            "elapsed_time": tool_call.elapsed_time,
        }

    def _generate_model_provider_icon_url(self, provider: str, dark: bool = False) -> str | None:
        """Generate icon URL for model provider."""
        from yarl import URL

        from configs import dify_config

        icon_type = "icon_small_dark" if dark else "icon_small"
        try:
            return str(
                URL(dify_config.CONSOLE_API_URL or "/")
                / "console"
                / "api"
                / "workspaces"
                / "current"
                / "model-providers"
                / provider
                / icon_type
                / "en_US"
            )
        except Exception:
            return None

    def _flush_model_segment(
        self,
        buffers: StreamBuffers,
        trace_state: TraceState,
        error: str | None = None,
    ) -> None:
        """Flush pending thought/content buffers into a single model trace segment."""
        if not buffers.pending_thought and not buffers.pending_content and not buffers.pending_tool_calls:
            return

        now = time.perf_counter()
        duration = now - trace_state.model_segment_start_time if trace_state.model_segment_start_time else 0.0

        # Use pending_usage from trace_state (captured from THOUGHT log)
        usage = trace_state.pending_usage

        # Generate model provider icon URL
        provider = self._node_data.model.provider
        model_name = self._node_data.model.name
        model_icon = self._generate_model_provider_icon_url(provider)
        model_icon_dark = self._generate_model_provider_icon_url(provider, dark=True)

        trace_state.trace_segments.append(
            LLMTraceSegment(
                type="model",
                duration=duration,
                usage=usage,
                output=ModelTraceSegment(
                    text="".join(buffers.pending_content) if buffers.pending_content else None,
                    reasoning="".join(buffers.pending_thought) if buffers.pending_thought else None,
                    tool_calls=list(buffers.pending_tool_calls),
                ),
                provider=provider,
                name=model_name,
                icon=model_icon,
                icon_dark=model_icon_dark,
                error=error,
                status="error" if error else "success",
            )
        )
        buffers.pending_thought.clear()
        buffers.pending_content.clear()
        buffers.pending_tool_calls.clear()
        trace_state.model_segment_start_time = None
        trace_state.pending_usage = None

    def _handle_agent_log_output(
        self, output: AgentLog, buffers: StreamBuffers, trace_state: TraceState, agent_context: AgentContext
    ) -> Generator[NodeEventBase, None, None]:
        payload = ToolLogPayload.from_log(output)
        agent_log_event = AgentLogEvent(
            message_id=output.id,
            label=output.label,
            node_execution_id=self.id,
            parent_id=output.parent_id,
            error=output.error,
            status=output.status.value,
            data=output.data,
            metadata={k.value: v for k, v in output.metadata.items()},
            node_id=self._node_id,
        )
        for log in agent_context.agent_logs:
            if log.message_id == agent_log_event.message_id:
                log.data = agent_log_event.data
                log.status = agent_log_event.status
                log.error = agent_log_event.error
                log.label = agent_log_event.label
                log.metadata = agent_log_event.metadata
                break
        else:
            agent_context.agent_logs.append(agent_log_event)

        # Handle THOUGHT log completion - capture usage for model segment
        if output.log_type == AgentLog.LogType.THOUGHT and output.status == AgentLog.LogStatus.SUCCESS:
            llm_usage = output.metadata.get(AgentLog.LogMetadata.LLM_USAGE) if output.metadata else None
            if llm_usage:
                trace_state.pending_usage = llm_usage

        if output.log_type == AgentLog.LogType.TOOL_CALL and output.status == AgentLog.LogStatus.START:
            tool_name = payload.tool_name
            tool_call_id = payload.tool_call_id
            tool_arguments = json.dumps(payload.tool_args) if payload.tool_args else ""

            # Get icon from metadata (available at START)
            tool_icon = output.metadata.get(AgentLog.LogMetadata.ICON) if output.metadata else None
            tool_icon_dark = output.metadata.get(AgentLog.LogMetadata.ICON_DARK) if output.metadata else None

            if tool_call_id and tool_call_id not in trace_state.tool_call_index_map:
                trace_state.tool_call_index_map[tool_call_id] = len(trace_state.tool_call_index_map)

            # Add tool call to pending list for model segment
            buffers.pending_tool_calls.append(ToolCall(id=tool_call_id, name=tool_name, arguments=tool_arguments))

            yield ToolCallChunkEvent(
                selector=[self._node_id, "generation", "tool_calls"],
                chunk=tool_arguments,
                tool_call=ToolCall(
                    id=tool_call_id,
                    name=tool_name,
                    arguments=tool_arguments,
                    icon=tool_icon,
                    icon_dark=tool_icon_dark,
                ),
                is_final=False,
            )

        if output.log_type == AgentLog.LogType.TOOL_CALL and output.status != AgentLog.LogStatus.START:
            tool_name = payload.tool_name
            tool_output = payload.tool_output
            tool_call_id = payload.tool_call_id
            tool_files = payload.files if isinstance(payload.files, list) else []
            tool_error = payload.tool_error
            tool_arguments = json.dumps(payload.tool_args) if payload.tool_args else ""

            if tool_call_id and tool_call_id not in trace_state.tool_call_index_map:
                trace_state.tool_call_index_map[tool_call_id] = len(trace_state.tool_call_index_map)

            # Flush model segment before tool result processing
            self._flush_model_segment(buffers, trace_state)

            if output.status == AgentLog.LogStatus.ERROR:
                tool_error = output.error or payload.tool_error
                if not tool_error and payload.meta:
                    tool_error = payload.meta.get("error")
            else:
                if payload.meta:
                    meta_error = payload.meta.get("error")
                    if meta_error:
                        tool_error = meta_error

            elapsed_time = output.metadata.get(AgentLog.LogMetadata.ELAPSED_TIME) if output.metadata else None
            tool_provider = output.metadata.get(AgentLog.LogMetadata.PROVIDER) if output.metadata else None
            tool_icon = output.metadata.get(AgentLog.LogMetadata.ICON) if output.metadata else None
            tool_icon_dark = output.metadata.get(AgentLog.LogMetadata.ICON_DARK) if output.metadata else None
            result_str = str(tool_output) if tool_output is not None else None

            tool_status: Literal["success", "error"] = "error" if tool_error else "success"
            tool_call_segment = LLMTraceSegment(
                type="tool",
                duration=elapsed_time or 0.0,
                usage=None,
                output=ToolTraceSegment(
                    id=tool_call_id,
                    name=tool_name,
                    arguments=tool_arguments,
                    output=result_str,
                ),
                provider=tool_provider,
                name=tool_name,
                icon=tool_icon,
                icon_dark=tool_icon_dark,
                error=str(tool_error) if tool_error else None,
                status=tool_status,
            )
            trace_state.trace_segments.append(tool_call_segment)
            if tool_call_id:
                trace_state.tool_trace_map[tool_call_id] = tool_call_segment

            # Start new model segment tracking
            trace_state.model_segment_start_time = time.perf_counter()

            yield ToolResultChunkEvent(
                selector=[self._node_id, "generation", "tool_results"],
                chunk=result_str or "",
                tool_result=ToolResult(
                    id=tool_call_id,
                    name=tool_name,
                    output=result_str,
                    files=tool_files,
                    status=ToolResultStatus.ERROR if tool_error else ToolResultStatus.SUCCESS,
                    elapsed_time=elapsed_time,
                    icon=tool_icon,
                    icon_dark=tool_icon_dark,
                ),
                is_final=False,
            )

            if buffers.current_turn_reasoning:
                buffers.reasoning_per_turn.append("".join(buffers.current_turn_reasoning))
                buffers.current_turn_reasoning.clear()

    def _handle_llm_chunk_output(
        self, output: LLMResultChunk, buffers: StreamBuffers, trace_state: TraceState, aggregate: AggregatedResult
    ) -> Generator[NodeEventBase, None, None]:
        message = output.delta.message

        if message and message.content:
            chunk_text = message.content
            if isinstance(chunk_text, list):
                chunk_text = "".join(getattr(content, "data", str(content)) for content in chunk_text)
            else:
                chunk_text = str(chunk_text)

            for kind, segment in buffers.think_parser.process(chunk_text):
                if not segment and kind not in {"thought_start", "thought_end"}:
                    continue

                # Start tracking model segment time on first output
                if trace_state.model_segment_start_time is None:
                    trace_state.model_segment_start_time = time.perf_counter()

                if kind == "thought_start":
                    yield ThoughtStartChunkEvent(
                        selector=[self._node_id, "generation", "thought"],
                        chunk="",
                        is_final=False,
                    )
                elif kind == "thought":
                    buffers.current_turn_reasoning.append(segment)
                    buffers.pending_thought.append(segment)
                    yield ThoughtChunkEvent(
                        selector=[self._node_id, "generation", "thought"],
                        chunk=segment,
                        is_final=False,
                    )
                elif kind == "thought_end":
                    yield ThoughtEndChunkEvent(
                        selector=[self._node_id, "generation", "thought"],
                        chunk="",
                        is_final=False,
                    )
                else:
                    aggregate.text += segment
                    buffers.pending_content.append(segment)
                    yield StreamChunkEvent(
                        selector=[self._node_id, "text"],
                        chunk=segment,
                        is_final=False,
                    )
                    yield StreamChunkEvent(
                        selector=[self._node_id, "generation", "content"],
                        chunk=segment,
                        is_final=False,
                    )

        if output.delta.usage:
            self._accumulate_usage(aggregate.usage, output.delta.usage)

        if output.delta.finish_reason:
            aggregate.finish_reason = output.delta.finish_reason

    def _flush_remaining_stream(
        self, buffers: StreamBuffers, trace_state: TraceState, aggregate: AggregatedResult
    ) -> Generator[NodeEventBase, None, None]:
        for kind, segment in buffers.think_parser.flush():
            if not segment and kind not in {"thought_start", "thought_end"}:
                continue

            # Start tracking model segment time on first output
            if trace_state.model_segment_start_time is None:
                trace_state.model_segment_start_time = time.perf_counter()

            if kind == "thought_start":
                yield ThoughtStartChunkEvent(
                    selector=[self._node_id, "generation", "thought"],
                    chunk="",
                    is_final=False,
                )
            elif kind == "thought":
                buffers.current_turn_reasoning.append(segment)
                buffers.pending_thought.append(segment)
                yield ThoughtChunkEvent(
                    selector=[self._node_id, "generation", "thought"],
                    chunk=segment,
                    is_final=False,
                )
            elif kind == "thought_end":
                yield ThoughtEndChunkEvent(
                    selector=[self._node_id, "generation", "thought"],
                    chunk="",
                    is_final=False,
                )
            else:
                aggregate.text += segment
                buffers.pending_content.append(segment)
                yield StreamChunkEvent(
                    selector=[self._node_id, "text"],
                    chunk=segment,
                    is_final=False,
                )
                yield StreamChunkEvent(
                    selector=[self._node_id, "generation", "content"],
                    chunk=segment,
                    is_final=False,
                )

        if buffers.current_turn_reasoning:
            buffers.reasoning_per_turn.append("".join(buffers.current_turn_reasoning))

        # For final flush, use aggregate.usage if pending_usage is not set
        # (e.g., for simple LLM calls without tool invocations)
        if trace_state.pending_usage is None:
            trace_state.pending_usage = aggregate.usage

        # Flush final model segment
        self._flush_model_segment(buffers, trace_state)

    def _close_streams(self) -> Generator[NodeEventBase, None, None]:
        yield StreamChunkEvent(
            selector=[self._node_id, "text"],
            chunk="",
            is_final=True,
        )
        yield StreamChunkEvent(
            selector=[self._node_id, "generation", "content"],
            chunk="",
            is_final=True,
        )
        yield ThoughtChunkEvent(
            selector=[self._node_id, "generation", "thought"],
            chunk="",
            is_final=True,
        )
        yield ToolCallChunkEvent(
            selector=[self._node_id, "generation", "tool_calls"],
            chunk="",
            tool_call=ToolCall(
                id="",
                name="",
                arguments="",
            ),
            is_final=True,
        )
        yield ToolResultChunkEvent(
            selector=[self._node_id, "generation", "tool_results"],
            chunk="",
            tool_result=ToolResult(
                id="",
                name="",
                output="",
                files=[],
                status=ToolResultStatus.SUCCESS,
            ),
            is_final=True,
        )

    def _build_generation_data(
        self,
        trace_state: TraceState,
        agent_context: AgentContext,
        aggregate: AggregatedResult,
        buffers: StreamBuffers,
    ) -> LLMGenerationData:
        sequence: list[dict[str, Any]] = []
        reasoning_index = 0
        content_position = 0
        tool_call_seen_index: dict[str, int] = {}
        for trace_segment in trace_state.trace_segments:
            if trace_segment.type == "thought":
                sequence.append({"type": "reasoning", "index": reasoning_index})
                reasoning_index += 1
            elif trace_segment.type == "content":
                segment_text = trace_segment.text or ""
                start = content_position
                end = start + len(segment_text)
                sequence.append({"type": "content", "start": start, "end": end})
                content_position = end
            elif trace_segment.type == "tool_call":
                tool_id = trace_segment.tool_call.id if trace_segment.tool_call and trace_segment.tool_call.id else ""
                if tool_id not in tool_call_seen_index:
                    tool_call_seen_index[tool_id] = len(tool_call_seen_index)
                sequence.append({"type": "tool_call", "index": tool_call_seen_index[tool_id]})

        tool_calls_for_generation: list[ToolCallResult] = []
        for log in agent_context.agent_logs:
            payload = ToolLogPayload.from_mapping(log.data or {})
            tool_call_id = payload.tool_call_id
            if not tool_call_id or log.status == AgentLog.LogStatus.START.value:
                continue

            tool_args = payload.tool_args
            log_error = payload.tool_error
            log_output = payload.tool_output
            result_text = log_output or log_error or ""
            status = ToolResultStatus.ERROR if log_error else ToolResultStatus.SUCCESS
            tool_calls_for_generation.append(
                ToolCallResult(
                    id=tool_call_id,
                    name=payload.tool_name,
                    arguments=json.dumps(tool_args) if tool_args else "",
                    output=result_text,
                    status=status,
                    elapsed_time=log.metadata.get(AgentLog.LogMetadata.ELAPSED_TIME) if log.metadata else None,
                )
            )

        tool_calls_for_generation.sort(
            key=lambda item: trace_state.tool_call_index_map.get(item.id or "", len(trace_state.tool_call_index_map))
        )

        return LLMGenerationData(
            text=aggregate.text,
            reasoning_contents=buffers.reasoning_per_turn,
            tool_calls=tool_calls_for_generation,
            sequence=sequence,
            usage=aggregate.usage,
            finish_reason=aggregate.finish_reason,
            files=aggregate.files,
            trace=trace_state.trace_segments,
        )

    def _process_tool_outputs(
        self,
        outputs: Generator[LLMResultChunk | AgentLog, None, AgentResult],
    ) -> Generator[NodeEventBase, None, LLMGenerationData]:
        """Process strategy outputs and convert to node events."""
        state = ToolOutputState()

        try:
            for output in outputs:
                if isinstance(output, AgentLog):
                    yield from self._handle_agent_log_output(output, state.stream, state.trace, state.agent)
                else:
                    yield from self._handle_llm_chunk_output(output, state.stream, state.trace, state.aggregate)
        except StopIteration as exception:
            if isinstance(getattr(exception, "value", None), AgentResult):
                state.agent.agent_result = exception.value

        if state.agent.agent_result:
            state.aggregate.text = state.agent.agent_result.text or state.aggregate.text
            state.aggregate.files = state.agent.agent_result.files
            if state.agent.agent_result.usage:
                state.aggregate.usage = state.agent.agent_result.usage
            if state.agent.agent_result.finish_reason:
                state.aggregate.finish_reason = state.agent.agent_result.finish_reason

        yield from self._flush_remaining_stream(state.stream, state.trace, state.aggregate)
        yield from self._close_streams()

        return self._build_generation_data(state.trace, state.agent, state.aggregate, state.stream)

    def _accumulate_usage(self, total_usage: LLMUsage, delta_usage: LLMUsage) -> None:
        """Accumulate LLM usage statistics."""
        total_usage.prompt_tokens += delta_usage.prompt_tokens
        total_usage.completion_tokens += delta_usage.completion_tokens
        total_usage.total_tokens += delta_usage.total_tokens
        total_usage.prompt_price += delta_usage.prompt_price
        total_usage.completion_price += delta_usage.completion_price
        total_usage.total_price += delta_usage.total_price


def _combine_message_content_with_role(
    *, contents: str | list[PromptMessageContentUnionTypes] | None = None, role: PromptMessageRole
):
    match role:
        case PromptMessageRole.USER:
            return UserPromptMessage(content=contents)
        case PromptMessageRole.ASSISTANT:
            return AssistantPromptMessage(content=contents)
        case PromptMessageRole.SYSTEM:
            return SystemPromptMessage(content=contents)
        case _:
            raise NotImplementedError(f"Role {role} is not supported")


def _render_jinja2_message(
    *,
    template: str,
    jinja2_variables: Sequence[VariableSelector],
    variable_pool: VariablePool,
):
    if not template:
        return ""

    jinja2_inputs = {}
    for jinja2_variable in jinja2_variables:
        variable = variable_pool.get(jinja2_variable.value_selector)
        jinja2_inputs[jinja2_variable.variable] = variable.to_object() if variable else ""
    code_execute_resp = CodeExecutor.execute_workflow_code_template(
        language=CodeLanguage.JINJA2,
        code=template,
        inputs=jinja2_inputs,
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
    context: str | None,
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
            jinja2_variables=jinja2_variables,
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
