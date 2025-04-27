import json
from collections.abc import Sequence
from typing import Optional, cast

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.file import file_manager
from core.memory.base_memory import BaseMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentUnionTypes,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.prompt.entities.advanced_prompt_entities import LLMMemoryType
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from extensions.ext_database import db
from factories import file_factory
from models.model import AppMode, Conversation, Message, MessageFile
from models.workflow import WorkflowNodeExecution, WorkflowNodeExecutionStatus, WorkflowRun


class ModelContextMemory(BaseMemory):
    def __init__(self, conversation: Conversation, node_id: str, model_instance: ModelInstance) -> None:
        self.conversation = conversation
        self.node_id = node_id
        self.model_instance = model_instance

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: Optional[int] = None
    ) -> Sequence[PromptMessage]:
        """
        Get history prompt messages.
        :param max_token_limit: max token limit
        :param message_limit: message limit
        """
        thread_messages = list(reversed(self._fetch_thread_messages(message_limit)))
        if not thread_messages:
            return []
        # Get all required workflow_run_ids
        workflow_run_ids = [msg.workflow_run_id for msg in thread_messages]

        # Batch query all related WorkflowNodeExecution records
        node_executions = (
            db.session.query(WorkflowNodeExecution)
            .filter(
                WorkflowNodeExecution.workflow_run_id.in_(workflow_run_ids),
                WorkflowNodeExecution.node_id == self.node_id,
                WorkflowNodeExecution.status.in_(
                    [WorkflowNodeExecutionStatus.SUCCEEDED, WorkflowNodeExecutionStatus.EXCEPTION]
                ),
            )
            .all()
        )

        # Create mapping from workflow_run_id to node_execution
        node_execution_map = {ne.workflow_run_id: ne for ne in node_executions}

        # Get the last node_execution
        last_node_execution = node_execution_map.get(thread_messages[-1].workflow_run_id)
        prompt_messages = self._get_prompt_messages_in_process_data(last_node_execution)

        # Batch query all message-related files
        message_ids = [msg.id for msg in thread_messages]
        all_files = db.session.query(MessageFile).filter(MessageFile.message_id.in_(message_ids)).all()

        # Create mapping from message_id to files
        files_map = {}
        for file in all_files:
            if file.message_id not in files_map:
                files_map[file.message_id] = []
            files_map[file.message_id].append(file)

        for message in thread_messages:
            files = files_map.get(message.id, [])
            node_execution = node_execution_map.get(message.workflow_run_id)
            if node_execution and files:
                file_objs, detail = self._handle_file(message, files)
                if file_objs:
                    outputs = node_execution.outputs_dict.get("text", "") if node_execution.outputs_dict else ""
                    if not outputs:
                        continue
                    if outputs not in [prompt.content for prompt in prompt_messages]:
                        continue
                    outputs_index = [prompt.content for prompt in prompt_messages].index(outputs)
                    prompt_index = outputs_index - 1
                    prompt_message_contents: list[PromptMessageContentUnionTypes] = []
                    content = cast(str, prompt_messages[prompt_index].content)
                    prompt_message_contents.append(TextPromptMessageContent(data=content))
                    for file in file_objs:
                        prompt_message = file_manager.to_prompt_message_content(
                            file,
                            image_detail_config=detail,
                        )
                        prompt_message_contents.append(prompt_message)
                    prompt_messages[prompt_index].content = prompt_message_contents
        return prompt_messages

    def _get_prompt_messages_in_process_data(
        self,
        node_execution: WorkflowNodeExecution,
    ) -> list[PromptMessage]:
        """
        Get prompt messages in process data.
        :param node_execution: node execution
        :return: prompt messages
        """
        prompt_messages = []
        if not node_execution.process_data:
            return []

        try:
            process_data = json.loads(node_execution.process_data)
            if process_data.get("memory_type", "") != LLMMemoryType.INDEPENDENT:
                return []
            prompts = process_data.get("prompts", [])
            for prompt in prompts:
                prompt_content = prompt.get("text", "")
                if prompt.get("role", "") == "user":
                    prompt_messages.append(UserPromptMessage(content=prompt_content))
                elif prompt.get("role", "") == "assistant":
                    prompt_messages.append(AssistantPromptMessage(content=prompt_content))
            output = node_execution.outputs_dict.get("text", "") if node_execution.outputs_dict else ""
            prompt_messages.append(AssistantPromptMessage(content=output))
        except json.JSONDecodeError:
            return []
        return prompt_messages

    def _fetch_thread_messages(self, message_limit: int | None = None) -> list[Message]:
        """
        Fetch thread messages.
        :param message_limit: message limit
        :return: thread messages
        """
        query = (
            db.session.query(
                Message.id,
                Message.query,
                Message.answer,
                Message.created_at,
                Message.workflow_run_id,
                Message.parent_message_id,
                Message.answer_tokens,
            )
            .filter(
                Message.conversation_id == self.conversation.id,
            )
            .order_by(Message.created_at.desc())
        )

        if message_limit and message_limit > 0:
            message_limit = min(message_limit, 500)
        else:
            message_limit = 500

        messages = query.limit(message_limit).all()

        # fetch the thread messages
        thread_messages = extract_thread_messages(messages)

        # for newly created message, its answer is temporarily empty, we don't need to add it to memory
        if thread_messages and not thread_messages[0].answer and thread_messages[0].answer_tokens == 0:
            thread_messages.pop(0)
        if not thread_messages:
            return []
        return thread_messages

    def _handle_file(self, message: Message, files: list[MessageFile]):
        """
        Handle file for memory.
        :param message: message
        :param files: files
        :return: file objects and detail
        """
        file_extra_config = None
        if self.conversation.mode not in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            file_extra_config = FileUploadConfigManager.convert(self.conversation.model_config)
        else:
            if message.workflow_run_id:
                workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == message.workflow_run_id).first()

                if workflow_run and workflow_run.workflow:
                    file_extra_config = FileUploadConfigManager.convert(
                        workflow_run.workflow.features_dict, is_vision=False
                    )

        detail = ImagePromptMessageContent.DETAIL.LOW
        app_record = self.conversation.app

        if file_extra_config and app_record:
            file_objs = file_factory.build_from_message_files(
                message_files=files, tenant_id=app_record.tenant_id, config=file_extra_config
            )
            if file_extra_config.image_config and file_extra_config.image_config.detail:
                detail = file_extra_config.image_config.detail
        else:
            file_objs = []
        return file_objs, detail
