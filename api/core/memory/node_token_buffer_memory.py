"""
Node-level Token Buffer Memory for Chatflow.

This module provides node-scoped memory within a conversation.
Each LLM node in a workflow can maintain its own independent conversation history.

Note: This is only available in Chatflow (advanced-chat mode) because it requires
both conversation_id and node_id.

Design:
- History is read directly from WorkflowNodeExecutionModel.outputs["context"]
- No separate storage needed - the context is already saved during node execution
- Thread tracking leverages Message table's parent_message_id structure
"""

import logging
from collections.abc import Sequence
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.file import file_manager
from core.memory.base import BaseMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    MultiModalPromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.message_entities import PromptMessageContentUnionTypes
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from extensions.ext_database import db
from models.model import Message
from models.workflow import WorkflowNodeExecutionModel

logger = logging.getLogger(__name__)


class NodeTokenBufferMemory(BaseMemory):
    """
    Node-level Token Buffer Memory.

    Provides node-scoped memory within a conversation. Each LLM node can maintain
    its own independent conversation history.

    Key design: History is read directly from WorkflowNodeExecutionModel.outputs["context"],
    which is already saved during node execution. No separate storage needed.
    """

    def __init__(
        self,
        app_id: str,
        conversation_id: str,
        node_id: str,
        tenant_id: str,
        model_instance: ModelInstance,
    ):
        self.app_id = app_id
        self.conversation_id = conversation_id
        self.node_id = node_id
        self.tenant_id = tenant_id
        self.model_instance = model_instance

    def _get_thread_workflow_run_ids(self) -> list[str]:
        """
        Get workflow_run_ids for the current thread by querying Message table.
        Returns workflow_run_ids in chronological order (oldest first).
        """
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = (
                select(Message)
                .where(Message.conversation_id == self.conversation_id)
                .order_by(Message.created_at.desc())
                .limit(500)
            )
            messages = list(session.scalars(stmt).all())

        if not messages:
            return []

        # Extract thread messages using existing logic
        thread_messages = extract_thread_messages(messages)

        # For newly created message, its answer is temporarily empty, skip it
        if thread_messages and not thread_messages[0].answer and thread_messages[0].answer_tokens == 0:
            thread_messages.pop(0)

        # Reverse to get chronological order, extract workflow_run_ids
        return [msg.workflow_run_id for msg in reversed(thread_messages) if msg.workflow_run_id]

    def _deserialize_prompt_message(self, msg_dict: dict) -> PromptMessage:
        """Deserialize a dict to PromptMessage based on role."""
        role = msg_dict.get("role")
        if role in (PromptMessageRole.USER, "user"):
            return UserPromptMessage.model_validate(msg_dict)
        elif role in (PromptMessageRole.ASSISTANT, "assistant"):
            return AssistantPromptMessage.model_validate(msg_dict)
        elif role in (PromptMessageRole.SYSTEM, "system"):
            return SystemPromptMessage.model_validate(msg_dict)
        elif role in (PromptMessageRole.TOOL, "tool"):
            return ToolPromptMessage.model_validate(msg_dict)
        else:
            return PromptMessage.model_validate(msg_dict)

    def _deserialize_context(self, context_data: list[dict]) -> list[PromptMessage]:
        """Deserialize context data from outputs to list of PromptMessage."""
        messages = []
        for msg_dict in context_data:
            try:
                msg = self._deserialize_prompt_message(msg_dict)
                msg = self._restore_multimodal_content(msg)
                messages.append(msg)
            except Exception as e:
                logger.warning("Failed to deserialize prompt message: %s", e)
        return messages

    def _restore_multimodal_content(self, message: PromptMessage) -> PromptMessage:
        """
        Restore multimodal content (base64 or url) from file_ref.

        When context is saved, base64_data is cleared to save storage space.
        This method restores the content by parsing file_ref (format: "method:id_or_url").
        """
        content = message.content
        if content is None or isinstance(content, str):
            return message

        # Process list content, restoring multimodal data from file references
        restored_content: list[PromptMessageContentUnionTypes] = []
        for item in content:
            if isinstance(item, MultiModalPromptMessageContent):
                # restore_multimodal_content preserves the concrete subclass type
                restored_item = file_manager.restore_multimodal_content(item)
                restored_content.append(cast(PromptMessageContentUnionTypes, restored_item))
            else:
                restored_content.append(item)

        return message.model_copy(update={"content": restored_content})

    def get_history_prompt_messages(
        self,
        *,
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> Sequence[PromptMessage]:
        """
        Retrieve history as PromptMessage sequence.
        History is read directly from the last completed node execution's outputs["context"].
        """
        _ = message_limit  # unused, kept for interface compatibility

        thread_workflow_run_ids = self._get_thread_workflow_run_ids()
        if not thread_workflow_run_ids:
            return []

        # Get the last completed workflow_run_id (contains accumulated context)
        last_run_id = thread_workflow_run_ids[-1]

        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.workflow_run_id == last_run_id,
                WorkflowNodeExecutionModel.node_id == self.node_id,
                WorkflowNodeExecutionModel.status == "succeeded",
            )
            execution = session.scalars(stmt).first()

            if not execution:
                return []

            outputs = execution.outputs_dict
            if not outputs:
                return []

            context_data = outputs.get("context")

        if not context_data or not isinstance(context_data, list):
            return []

        prompt_messages = self._deserialize_context(context_data)
        if not prompt_messages:
            return []

        # Truncate by token limit
        try:
            current_tokens = self.model_instance.get_llm_num_tokens(prompt_messages)
            while current_tokens > max_token_limit and len(prompt_messages) > 1:
                prompt_messages.pop(0)
                current_tokens = self.model_instance.get_llm_num_tokens(prompt_messages)
        except Exception as e:
            logger.warning("Failed to count tokens for truncation: %s", e)

        return prompt_messages
