"""Agent V2 Node implementation."""

import logging
from collections.abc import Generator, Mapping, Sequence
from typing import Any

from core.agent.entities import AgentLog, AgentResult, AgentToolEntity, ExecutionContext
from core.agent.patterns import StrategyFactory
from core.agent.tools.manager import AgentBuiltinToolsManager
from core.file import File, file_manager
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities import (
    LLMUsage,
    PromptMessage,
    PromptMessageRole,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.llm_entities import LLMResultChunk
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessageContentUnionTypes,
    TextPromptMessageContent,
)
from core.model_runtime.entities.model_entities import ModelFeature, ModelType
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.__base.tool import Tool
from core.tools.tool_manager import ToolManager
from core.variables import ArrayFileSegment
from core.workflow.entities import VariablePool
from core.workflow.enums import (
    ErrorStrategy,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.node_events import (
    AgentLogEvent,
    NodeEventBase,
    NodeRunResult,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from core.workflow.nodes.agent.v2.entities import AgentV2NodeData
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.nodes.llm.entities import LLMNodeCompletionModelPromptTemplate

logger = logging.getLogger(__name__)


class AgentNode(Node):
    """
    Agent V2 Node - Direct implementation without plugin dependency.

    This node automatically selects between Function Call and ReAct strategies
    based on model capabilities.
    """

    node_type = NodeType.AGENT
    _node_data: AgentV2NodeData

    def init_node_data(self, data: Mapping[str, Any]):
        """Initialize node data from configuration."""
        self._node_data = AgentV2NodeData.model_validate(data)

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
    def version(cls) -> str:
        """Return node version."""
        return "2"

    def _run(self) -> Generator[NodeEventBase, None, None]:
        """Execute the agent node."""
        variable_pool = self.graph_runtime_state.variable_pool

        try:
            # Get model instance and configuration
            model_instance = self._fetch_model_instance()
            model_config = self._node_data.model

            # Get model features to determine strategy
            model_features = self._get_model_features(model_instance)

            # Prepare tools
            tool_instances = self._prepare_tool_instances(variable_pool)
            history_prompt: Sequence[PromptMessage] = []
            if self._node_data.memory:
                from core.workflow.nodes.llm import llm_utils

                memory = llm_utils.fetch_memory(
                    variable_pool=variable_pool,
                    app_id=self.app_id,
                    node_data_memory=self._node_data.memory,
                    model_instance=model_instance,
                )
                if memory:
                    history_prompt = memory.get_history_prompt_messages(
                        max_token_limit=self._node_data.memory.window.size or 2000
                    )

            # Fetch vision files (these go directly to model)
            vision_files = self._fetch_vision_files(variable_pool) if self._node_data.vision.enabled else []

            # Prepare prompt messages and extract prompt files
            prompt_messages, prompt_files = self._prepare_prompt_messages(variable_pool, vision_files, history_prompt)

            # Use factory to create appropriate strategy
            strategy = StrategyFactory.create_strategy(
                model_features=model_features,
                model_instance=model_instance,
                tools=tool_instances,
                max_iterations=10,
                # TODO conversation_id and message_id
                context=ExecutionContext(user_id=self.user_id, app_id=self.app_id, tenant_id=self.tenant_id),
            )

            # Add file dispatcher if prompt files exist
            if prompt_files:
                file_dispatcher = AgentBuiltinToolsManager.create_file_dispatcher(prompt_files)
                if file_dispatcher:
                    # Add file dispatcher to strategy's tools
                    strategy.tools = list(strategy.tools) + [file_dispatcher]

                    # Add tool file parameter info to prompt
                    self._add_tool_file_params_to_messages(prompt_messages, strategy.tools)

            # Run strategy
            outputs = strategy.run(
                prompt_messages=prompt_messages,
                model_parameters=model_config.completion_params,
                stop=model_config.completion_params.get("stop", []),
                stream=True,
            )

            # Process outputs
            yield from self._process_outputs(outputs, strategy)

        except Exception as e:
            logger.exception("Agent V2 node execution failed: %s")
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error=str(e),
                )
            )

    def _fetch_model_instance(self) -> ModelInstance:
        """Fetch model instance from configuration."""
        model_config = self._node_data.model
        model_manager = ModelManager()

        return model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=model_config.provider,
            model_type=ModelType.LLM,
            model=model_config.name,
        )

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

        # Add configured tools
        if self._node_data.tools:
            for tool in self._node_data.tools:
                try:
                    # Create AgentToolEntity from ToolMetadata
                    agent_tool = AgentToolEntity(
                        provider_id=tool.provider_name,
                        provider_type=tool.type,
                        tool_name=tool.tool_name,
                        tool_parameters=tool.parameters,
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
                    tool_instances.append(tool_runtime)
                except Exception as e:
                    logger.warning("Failed to load tool %s: %s", tool, str(e))
                    continue

        return tool_instances

    def _fetch_vision_files(self, variable_pool: VariablePool) -> Sequence[File]:
        """Fetch files from vision configuration - these go directly to model."""
        from core.workflow.nodes.llm import llm_utils

        return llm_utils.fetch_files(
            variable_pool=variable_pool,
            selector=self._node_data.vision.configs.variable_selector,
        )

    def _prepare_prompt_messages(
        self,
        variable_pool: VariablePool,
        files: Sequence[File] = [],
        history_prompt: Sequence[PromptMessage] = [],
    ) -> tuple[list[PromptMessage], list[File]]:
        """Prepare prompt messages from template and extract file variables."""
        prompt_messages: list[PromptMessage] = list(history_prompt)
        prompt_files: list[File] = []

        # Handle chat model messages
        if isinstance(self._node_data.prompt_template, list):
            for i, message in enumerate(self._node_data.prompt_template):
                # Process message based on edition type
                if message.edition_type == "jinja2" and message.jinja2_text:
                    # Handle jinja2 template
                    content = self._process_jinja2_template(message, variable_pool)
                elif message.text:
                    # Handle basic template with variable substitution
                    content, extracted_files = self._process_template_variables_and_extract_files(
                        message.text, variable_pool
                    )
                    prompt_files.extend(extracted_files)
                else:
                    content = ""

                # Create appropriate message type
                if message.role == PromptMessageRole.SYSTEM:
                    prompt_messages.insert(0, SystemPromptMessage(content=content))
                elif message.role == PromptMessageRole.USER:
                    # Check if this is the last user message and we have files
                    is_last_user_message = (i == len(self._node_data.prompt_template) - 1) or all(
                        msg.role != PromptMessageRole.USER for msg in self._node_data.prompt_template[i + 1 :]
                    )

                    if files and is_last_user_message:
                        prompt_messages.append(self._create_user_message_with_files(content, files))
                    else:
                        prompt_messages.append(UserPromptMessage(content=content))

        # Add file information for prompt files (not vision files)
        if prompt_files:
            self._add_file_info_to_messages(prompt_messages, prompt_files)

        return prompt_messages, prompt_files

    def _create_user_message_with_files(self, text_content: str, files: Sequence[File]) -> UserPromptMessage:
        """Create a user message with files attached."""
        # Get image detail config
        image_detail_config = (
            self._node_data.vision.configs.detail
            if self._node_data.vision.enabled
            else ImagePromptMessageContent.DETAIL.LOW
        )

        # Convert files to prompt message content
        prompt_message_contents: list[PromptMessageContentUnionTypes] = []

        # Add files first
        for file in files:
            file_content = file_manager.to_prompt_message_content(
                file,
                image_detail_config=image_detail_config,
            )
            prompt_message_contents.append(file_content)

        # Add text content
        if text_content:
            prompt_message_contents.append(TextPromptMessageContent(data=text_content))

        return UserPromptMessage(content=prompt_message_contents)

    def _process_template_variables(self, template: str, variable_pool: VariablePool) -> str:
        """Process variables in template string."""
        content, _ = self._process_template_variables_and_extract_files(template, variable_pool)
        return content

    def _process_template_variables_and_extract_files(
        self, template: str, variable_pool: VariablePool
    ) -> tuple[str, list[File]]:
        """Process variables in template string and extract file variables."""
        from core.variables import ArrayFileVariable, FileVariable

        # Use VariableTemplateParser to extract and replace variables
        parser = VariableTemplateParser(template)
        variable_selectors = parser.extract_variable_selectors()

        # Build inputs for formatting and collect files
        inputs = {}
        files: list[File] = []

        for variable_selector in variable_selectors:
            variable = variable_pool.get(variable_selector.value_selector)
            if variable is None:
                # Use empty string for missing variables
                inputs[variable_selector.variable] = ""
            else:
                # Check if it's a file variable
                if isinstance(variable, FileVariable) and variable.value:
                    files.append(variable.value)
                elif isinstance(variable, ArrayFileVariable) and variable.value:
                    files.extend(variable.value)

                # Convert variable to object representation
                inputs[variable_selector.variable] = variable.to_object()

        # Format the template with actual values
        return parser.format(inputs), files

    def _process_jinja2_template(self, template_obj: Any, variable_pool: VariablePool) -> str:
        """Process jinja2 template with variables."""
        # Import CodeExecutor for jinja2 processing
        from core.helper.code_executor import CodeExecutor, CodeLanguage

        # Get jinja2 template text
        jinja2_text = getattr(template_obj, "jinja2_text", None)
        if not jinja2_text:
            return ""

        # Prepare jinja2 variables
        jinja2_inputs = {}
        if self._node_data.prompt_config and self._node_data.prompt_config.jinja2_variables:
            for variable_selector in self._node_data.prompt_config.jinja2_variables:
                variable = variable_pool.get(variable_selector.value_selector)
                if variable is None:
                    jinja2_inputs[variable_selector.variable] = ""
                else:
                    jinja2_inputs[variable_selector.variable] = variable.to_object()

        # Execute jinja2 template
        code_execute_resp = CodeExecutor.execute_workflow_code_template(
            language=CodeLanguage.JINJA2,
            code=jinja2_text,
            inputs=jinja2_inputs,
        )

        return code_execute_resp.get("result", "")

    def _process_outputs(
        self, outputs: Generator[LLMResultChunk | AgentLog, None, AgentResult], strategy: Any
    ) -> Generator[NodeEventBase, None, None]:
        """Process strategy outputs and convert to node events."""
        text = ""
        files: list[File] = []
        usage = LLMUsage.empty_usage()
        agent_logs: list[AgentLogEvent] = []
        finish_reason = None
        agent_result: AgentResult | None = None

        # Process each output from strategy
        try:
            for output in outputs:
                if isinstance(output, AgentLog):
                    # Store agent log event for metadata
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
                    for log in agent_logs:
                        if log.message_id == agent_log_event.message_id:
                            # update the log
                            log.data = agent_log_event.data
                            log.status = agent_log_event.status
                            log.error = agent_log_event.error
                            log.label = agent_log_event.label
                            log.metadata = agent_log_event.metadata
                            break
                    else:
                        agent_logs.append(agent_log_event)

                    # Tool outputs are handled by the strategy itself

                    yield agent_log_event
                elif isinstance(output, LLMResultChunk):
                    # Handle LLM result chunks
                    if output.delta.message and output.delta.message.content:
                        chunk_text = output.delta.message.content
                        if isinstance(chunk_text, list):
                            # Extract text from content list
                            chunk_text = "".join(getattr(c, "data", str(c)) for c in chunk_text)
                        else:
                            chunk_text = str(chunk_text)
                        text += chunk_text
                        yield StreamChunkEvent(
                            selector=[self._node_id, "text"],
                            chunk=chunk_text,
                            is_final=False,
                        )

                    if output.delta.usage:
                        self._accumulate_usage(usage, output.delta.usage)

                    # Capture finish reason
                    if output.delta.finish_reason:
                        finish_reason = output.delta.finish_reason

        except StopIteration as e:
            # Get the return value from generator
            if isinstance(getattr(e, "value", None), AgentResult):
                agent_result = e.value

        # Use result from generator if available
        if agent_result:
            text = agent_result.text or text
            files = agent_result.files
            if agent_result.usage:
                usage = agent_result.usage
            if agent_result.finish_reason:
                finish_reason = agent_result.finish_reason
        # else: Fallback - no files from old approach

        # Send final events for all streams
        yield StreamChunkEvent(
            selector=[self._node_id, "text"],
            chunk="",
            is_final=True,
        )

        # Complete with results
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={
                    "text": text,
                    "files": ArrayFileSegment(value=files),
                    "usage": jsonable_encoder(usage),
                    "finish_reason": finish_reason,
                },
                metadata={
                    WorkflowNodeExecutionMetadataKey.AGENT_LOG: agent_logs,
                },
                inputs=self._prepare_inputs_for_log(),
                llm_usage=usage,
            )
        )

    def _add_file_info_to_messages(self, prompt_messages: list[PromptMessage], prompt_files: Sequence[File]) -> None:
        """Add file information to prompt messages."""
        from core.agent.tools.prompt import generate_file_prompt

        file_info = generate_file_prompt(prompt_files)

        # Add to system message or create new one
        if prompt_messages and isinstance(prompt_messages[0], SystemPromptMessage):
            # Ensure content is string before concatenation
            existing_content = prompt_messages[0].content
            if isinstance(existing_content, str):
                prompt_messages[0].content = existing_content + f"\n\n{file_info}"
            else:
                # If content is not string, create new system message
                prompt_messages.insert(0, SystemPromptMessage(content=file_info))
        else:
            # Insert at beginning if no system message exists
            prompt_messages.insert(0, SystemPromptMessage(content=file_info))

    def _add_tool_file_params_to_messages(self, prompt_messages: list[PromptMessage], tools: Sequence[Tool]) -> None:
        """Add tool file parameter information to prompt messages."""
        from core.agent.tools.prompt import generate_tool_file_params_prompt

        tool_file_info = generate_tool_file_params_prompt(tools)
        if not tool_file_info:
            return

        # Add to system message or create new one
        if prompt_messages and isinstance(prompt_messages[0], SystemPromptMessage):
            # Ensure content is string before concatenation
            existing_content = prompt_messages[0].content
            if isinstance(existing_content, str):
                prompt_messages[0].content = existing_content + f"\n{tool_file_info}"
            else:
                # If content is not string, create new system message
                prompt_messages.insert(0, SystemPromptMessage(content=tool_file_info))
        else:
            # Insert at beginning if no system message exists
            prompt_messages.insert(0, SystemPromptMessage(content=tool_file_info))

    def _accumulate_usage(self, total_usage: LLMUsage, delta_usage: LLMUsage) -> None:
        """Accumulate LLM usage statistics."""
        total_usage.prompt_tokens += delta_usage.prompt_tokens
        total_usage.completion_tokens += delta_usage.completion_tokens
        total_usage.total_tokens += delta_usage.total_tokens
        total_usage.prompt_price += delta_usage.prompt_price
        total_usage.completion_price += delta_usage.completion_price
        total_usage.total_price += delta_usage.total_price

    def _prepare_inputs_for_log(self) -> dict[str, Any]:
        """Prepare inputs for logging, removing sensitive information."""
        inputs = {
            "model": {
                "provider": self._node_data.model.provider,
                "name": self._node_data.model.name,
            },
            "tools": [
                {
                    "provider_id": tool.provider_name,
                    "tool_name": tool.tool_name,
                }
                for tool in self._node_data.tools
            ]
            if self._node_data.tools
            else [],
        }

        # Add prompt template info
        if isinstance(self._node_data.prompt_template, list):
            inputs["prompt_template"] = [{"role": msg.role.value} for msg in self._node_data.prompt_template]
        else:
            inputs["prompt_template"] = "completion_mode"

        return inputs

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """Extract variable selectors from node configuration."""
        # Create typed NodeData from dict
        typed_node_data = AgentV2NodeData.model_validate(node_data)

        variable_mapping: dict[str, Any] = {}

        # Extract variables from prompt template
        prompt_template = typed_node_data.prompt_template
        variable_selectors = []

        if isinstance(prompt_template, list):
            # For chat model messages
            for prompt in prompt_template:
                # Skip jinja2 templates (handled separately)
                if prompt.edition_type == "jinja2":
                    continue
                if prompt.text:
                    parser = VariableTemplateParser(template=prompt.text)
                    variable_selectors.extend(parser.extract_variable_selectors())
        elif isinstance(prompt_template, LLMNodeCompletionModelPromptTemplate):
            # For completion model prompt template
            if prompt_template.edition_type != "jinja2" and prompt_template.text:
                parser = VariableTemplateParser(template=prompt_template.text)
                variable_selectors = parser.extract_variable_selectors()

        # Add variable selectors to mapping
        for variable_selector in variable_selectors:
            variable_mapping[variable_selector.variable] = variable_selector.value_selector

        # Extract variables from memory query prompt template
        memory = typed_node_data.memory
        if memory and memory.query_prompt_template:
            query_parser = VariableTemplateParser(template=memory.query_prompt_template)
            query_variable_selectors = query_parser.extract_variable_selectors()
            for variable_selector in query_variable_selectors:
                variable_mapping[variable_selector.variable] = variable_selector.value_selector

        # Add context variable if enabled
        if typed_node_data.context.enabled and typed_node_data.context.variable_selector:
            variable_mapping["#context#"] = typed_node_data.context.variable_selector

        # Add vision files variable if enabled
        if typed_node_data.vision.enabled and typed_node_data.vision.configs.variable_selector:
            variable_mapping["#files#"] = typed_node_data.vision.configs.variable_selector

        # Extract variables from tool configurations
        if typed_node_data.tools:
            for tool_idx, tool_config in enumerate(typed_node_data.tools):
                # Get tool parameters from ToolMetadata
                if tool_config.parameters:
                    for param_name, param_value in tool_config.parameters.items():
                        if isinstance(param_value, str):
                            # Parse template variables in tool parameters
                            tool_parser = VariableTemplateParser(template=param_value)
                            tool_variable_selectors = tool_parser.extract_variable_selectors()
                            for variable_selector in tool_variable_selectors:
                                # Use a unique key for tool variables
                                tool_var_key = f"#tool_{tool_idx}_{param_name}_{variable_selector.variable}#"
                                variable_mapping[tool_var_key] = variable_selector.value_selector

        # Handle jinja2 variables if prompt config exists
        if typed_node_data.prompt_config and typed_node_data.prompt_config.jinja2_variables:
            # Check if any prompt uses jinja2
            enable_jinja = False
            if isinstance(prompt_template, list):
                for prompt in prompt_template:
                    if prompt.edition_type == "jinja2":
                        enable_jinja = True
                        break
            elif (
                isinstance(prompt_template, LLMNodeCompletionModelPromptTemplate)
                and prompt_template.edition_type == "jinja2"
            ):
                enable_jinja = True

            if enable_jinja and typed_node_data.prompt_config.jinja2_variables:
                for variable_selector in typed_node_data.prompt_config.jinja2_variables:
                    variable_mapping[variable_selector.variable] = variable_selector.value_selector

        # Add node_id prefix to all variable keys
        variable_mapping = {node_id + "." + key: value for key, value in variable_mapping.items()}

        return variable_mapping
