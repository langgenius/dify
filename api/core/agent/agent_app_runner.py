import logging
from collections.abc import Generator
from copy import deepcopy
from typing import Any

from core.agent.base_agent_runner import BaseAgentRunner
from core.agent.entities import AgentEntity, AgentLog, AgentResult
from core.agent.patterns.strategy_factory import StrategyFactory
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.queue_entities import QueueAgentThoughtEvent, QueueMessageEndEvent, QueueMessageFileEvent
from core.file import file_manager
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMUsage,
    PromptMessage,
    PromptMessageContentType,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.message_entities import ImagePromptMessageContent, PromptMessageContentUnionTypes
from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMeta
from core.tools.tool_engine import ToolEngine
from models.model import Message

logger = logging.getLogger(__name__)


class AgentAppRunner(BaseAgentRunner):
    def _create_tool_invoke_hook(self, message: Message):
        """
        Create a tool invoke hook that uses ToolEngine.agent_invoke.
        This hook handles file creation and returns proper meta information.
        """
        # Get trace manager from app generate entity
        trace_manager = self.application_generate_entity.trace_manager

        def tool_invoke_hook(
            tool: Tool, tool_args: dict[str, Any], tool_name: str
        ) -> tuple[str, list[str], ToolInvokeMeta]:
            """Hook that uses agent_invoke for proper file and meta handling."""
            tool_invoke_response, message_files, tool_invoke_meta = ToolEngine.agent_invoke(
                tool=tool,
                tool_parameters=tool_args,
                user_id=self.user_id,
                tenant_id=self.tenant_id,
                message=message,
                invoke_from=self.application_generate_entity.invoke_from,
                agent_tool_callback=self.agent_callback,
                trace_manager=trace_manager,
                app_id=self.application_generate_entity.app_config.app_id,
                message_id=message.id,
                conversation_id=self.conversation.id,
            )

            # Publish files and track IDs
            for message_file_id in message_files:
                self.queue_manager.publish(
                    QueueMessageFileEvent(message_file_id=message_file_id),
                    PublishFrom.APPLICATION_MANAGER,
                )
                self._current_message_file_ids.append(message_file_id)

            return tool_invoke_response, message_files, tool_invoke_meta

        return tool_invoke_hook

    def run(self, message: Message, query: str, **kwargs: Any) -> Generator[LLMResultChunk, None, None]:
        """
        Run Agent application
        """
        self.query = query
        app_generate_entity = self.application_generate_entity

        app_config = self.app_config
        assert app_config is not None, "app_config is required"
        assert app_config.agent is not None, "app_config.agent is required"

        # convert tools into ModelRuntime Tool format
        tool_instances, _ = self._init_prompt_tools()

        assert app_config.agent

        # Create tool invoke hook for agent_invoke
        tool_invoke_hook = self._create_tool_invoke_hook(message)

        # Get instruction for ReAct strategy
        instruction = self.app_config.prompt_template.simple_prompt_template or ""

        # Use factory to create appropriate strategy
        strategy = StrategyFactory.create_strategy(
            model_features=self.model_features,
            model_instance=self.model_instance,
            tools=list(tool_instances.values()),
            files=list(self.files),
            max_iterations=app_config.agent.max_iteration,
            context=self.build_execution_context(),
            agent_strategy=self.config.strategy,
            tool_invoke_hook=tool_invoke_hook,
            instruction=instruction,
        )

        # Initialize state variables
        current_agent_thought_id = None
        has_published_thought = False
        current_tool_name: str | None = None
        self._current_message_file_ids = []

        # organize prompt messages
        prompt_messages = self._organize_prompt_messages()

        # Run strategy
        generator = strategy.run(
            prompt_messages=prompt_messages,
            model_parameters=app_generate_entity.model_conf.parameters,
            stop=app_generate_entity.model_conf.stop,
            stream=True,
        )

        # Consume generator and collect result
        result: AgentResult | None = None
        try:
            while True:
                try:
                    output = next(generator)
                except StopIteration as e:
                    # Generator finished, get the return value
                    result = e.value
                    break

                if isinstance(output, LLMResultChunk):
                    # Handle LLM chunk
                    if current_agent_thought_id and not has_published_thought:
                        self.queue_manager.publish(
                            QueueAgentThoughtEvent(agent_thought_id=current_agent_thought_id),
                            PublishFrom.APPLICATION_MANAGER,
                        )
                        has_published_thought = True

                    yield output

                elif isinstance(output, AgentLog):
                    # Handle Agent Log using log_type for type-safe dispatch
                    if output.status == AgentLog.LogStatus.START:
                        if output.log_type == AgentLog.LogType.ROUND:
                            # Start of a new round
                            message_file_ids: list[str] = []
                            current_agent_thought_id = self.create_agent_thought(
                                message_id=message.id,
                                message="",
                                tool_name="",
                                tool_input="",
                                messages_ids=message_file_ids,
                            )
                            has_published_thought = False

                        elif output.log_type == AgentLog.LogType.TOOL_CALL:
                            if current_agent_thought_id is None:
                                continue

                            # Tool call start - extract data from structured fields
                            current_tool_name = output.data.get("tool_name", "")
                            tool_input = output.data.get("tool_args", {})

                            self.save_agent_thought(
                                agent_thought_id=current_agent_thought_id,
                                tool_name=current_tool_name,
                                tool_input=tool_input,
                                thought=None,
                                observation=None,
                                tool_invoke_meta=None,
                                answer=None,
                                messages_ids=[],
                            )
                            self.queue_manager.publish(
                                QueueAgentThoughtEvent(agent_thought_id=current_agent_thought_id),
                                PublishFrom.APPLICATION_MANAGER,
                            )

                    elif output.status == AgentLog.LogStatus.SUCCESS:
                        if output.log_type == AgentLog.LogType.THOUGHT:
                            pass

                        elif output.log_type == AgentLog.LogType.TOOL_CALL:
                            if current_agent_thought_id is None:
                                continue

                            # Tool call finished
                            tool_output = output.data.get("output")
                            # Get meta from strategy output (now properly populated)
                            tool_meta = output.data.get("meta")

                            # Wrap tool_meta with tool_name as key (required by agent_service)
                            if tool_meta and current_tool_name:
                                tool_meta = {current_tool_name: tool_meta}

                            self.save_agent_thought(
                                agent_thought_id=current_agent_thought_id,
                                tool_name=None,
                                tool_input=None,
                                thought=None,
                                observation=tool_output,
                                tool_invoke_meta=tool_meta,
                                answer=None,
                                messages_ids=self._current_message_file_ids,
                            )
                            # Clear message file ids after saving
                            self._current_message_file_ids = []
                            current_tool_name = None

                            self.queue_manager.publish(
                                QueueAgentThoughtEvent(agent_thought_id=current_agent_thought_id),
                                PublishFrom.APPLICATION_MANAGER,
                            )

                        elif output.log_type == AgentLog.LogType.ROUND:
                            if current_agent_thought_id is None:
                                continue

                            # Round finished - save LLM usage and answer
                            llm_usage = output.metadata.get(AgentLog.LogMetadata.LLM_USAGE)
                            llm_result = output.data.get("llm_result")
                            final_answer = output.data.get("final_answer")

                            self.save_agent_thought(
                                agent_thought_id=current_agent_thought_id,
                                tool_name=None,
                                tool_input=None,
                                thought=llm_result,
                                observation=None,
                                tool_invoke_meta=None,
                                answer=final_answer,
                                messages_ids=[],
                                llm_usage=llm_usage,
                            )
                            self.queue_manager.publish(
                                QueueAgentThoughtEvent(agent_thought_id=current_agent_thought_id),
                                PublishFrom.APPLICATION_MANAGER,
                            )

        except Exception:
            # Re-raise any other exceptions
            raise

        # Process final result
        if isinstance(result, AgentResult):
            final_answer = result.text
            usage = result.usage or LLMUsage.empty_usage()

            # Publish end event
            self.queue_manager.publish(
                QueueMessageEndEvent(
                    llm_result=LLMResult(
                        model=self.model_instance.model,
                        prompt_messages=prompt_messages,
                        message=AssistantPromptMessage(content=final_answer),
                        usage=usage,
                        system_fingerprint="",
                    )
                ),
                PublishFrom.APPLICATION_MANAGER,
            )

    def _init_system_message(self, prompt_template: str, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Initialize system message
        """
        if not prompt_messages and prompt_template:
            return [
                SystemPromptMessage(content=prompt_template),
            ]

        if prompt_messages and not isinstance(prompt_messages[0], SystemPromptMessage) and prompt_template:
            prompt_messages.insert(0, SystemPromptMessage(content=prompt_template))

        return prompt_messages or []

    def _organize_user_query(self, query: str, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Organize user query
        """
        if self.files:
            # get image detail config
            image_detail_config = (
                self.application_generate_entity.file_upload_config.image_config.detail
                if (
                    self.application_generate_entity.file_upload_config
                    and self.application_generate_entity.file_upload_config.image_config
                )
                else None
            )
            image_detail_config = image_detail_config or ImagePromptMessageContent.DETAIL.LOW

            prompt_message_contents: list[PromptMessageContentUnionTypes] = []
            for file in self.files:
                prompt_message_contents.append(
                    file_manager.to_prompt_message_content(
                        file,
                        image_detail_config=image_detail_config,
                    )
                )
            prompt_message_contents.append(TextPromptMessageContent(data=query))

            prompt_messages.append(UserPromptMessage(content=prompt_message_contents))
        else:
            prompt_messages.append(UserPromptMessage(content=query))

        return prompt_messages

    def _clear_user_prompt_image_messages(self, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        As for now, gpt supports both fc and vision at the first iteration.
        We need to remove the image messages from the prompt messages at the first iteration.
        """
        prompt_messages = deepcopy(prompt_messages)

        for prompt_message in prompt_messages:
            if isinstance(prompt_message, UserPromptMessage):
                if isinstance(prompt_message.content, list):
                    prompt_message.content = "\n".join(
                        [
                            content.data
                            if content.type == PromptMessageContentType.TEXT
                            else "[image]"
                            if content.type == PromptMessageContentType.IMAGE
                            else "[file]"
                            for content in prompt_message.content
                        ]
                    )

        return prompt_messages

    def _organize_prompt_messages(self):
        # For ReAct strategy, use the agent prompt template
        if self.config.strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT and self.config.prompt:
            prompt_template = self.config.prompt.first_prompt
        else:
            prompt_template = self.app_config.prompt_template.simple_prompt_template or ""

        self.history_prompt_messages = self._init_system_message(prompt_template, self.history_prompt_messages)
        query_prompt_messages = self._organize_user_query(self.query or "", [])

        self.history_prompt_messages = AgentHistoryPromptTransform(
            model_config=self.model_config,
            prompt_messages=[*query_prompt_messages, *self._current_thoughts],
            history_messages=self.history_prompt_messages,
            memory=self.memory,
        ).get_prompt()

        prompt_messages = [*self.history_prompt_messages, *query_prompt_messages, *self._current_thoughts]
        if len(self._current_thoughts) != 0:
            # clear messages after the first iteration
            prompt_messages = self._clear_user_prompt_image_messages(prompt_messages)
        return prompt_messages
