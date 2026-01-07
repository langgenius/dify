"""
Node-level Token Buffer Memory for Chatflow.

This module provides node-scoped memory within a conversation.
Each LLM node in a workflow can maintain its own independent conversation history.

Note: This is only available in Chatflow (advanced-chat mode) because it requires
both conversation_id and node_id.

Design:
- Storage is indexed by workflow_run_id (each execution stores one turn)
- Thread tracking leverages Message table's parent_message_id structure
- On read: query Message table for current thread, then filter Node Memory by workflow_run_ids
"""

import logging
from collections.abc import Sequence

from pydantic import BaseModel
from sqlalchemy import select

from core.file import File, FileTransferMethod
from core.memory.base import BaseMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import Message

logger = logging.getLogger(__name__)


class NodeMemoryFile(BaseModel):
    """File reference stored in node memory."""

    type: str  # image, audio, video, document, custom
    transfer_method: str  # local_file, remote_url, tool_file
    upload_file_id: str | None = None
    tool_file_id: str | None = None
    url: str | None = None


class NodeMemoryTurn(BaseModel):
    """A single dialogue turn (user + assistant) in node memory."""

    user_content: str = ""
    user_files: list[NodeMemoryFile] = []
    assistant_content: str = ""
    assistant_files: list[NodeMemoryFile] = []


class NodeMemoryData(BaseModel):
    """Root data structure for node memory storage."""

    version: int = 1
    # Key: workflow_run_id, Value: dialogue turn
    turns: dict[str, NodeMemoryTurn] = {}


class NodeTokenBufferMemory(BaseMemory):
    """
    Node-level Token Buffer Memory.

    Provides node-scoped memory within a conversation. Each LLM node can maintain
    its own independent conversation history, stored in object storage.

    Key design: Thread tracking is delegated to Message table's parent_message_id.
    Storage is indexed by workflow_run_id for easy filtering.

    Storage key format: node_memory/{app_id}/{conversation_id}/{node_id}.json
    """

    def __init__(
        self,
        app_id: str,
        conversation_id: str,
        node_id: str,
        tenant_id: str,
        model_instance: ModelInstance,
    ):
        """
        Initialize node-level memory.

        :param app_id: Application ID
        :param conversation_id: Conversation ID
        :param node_id: Node ID in the workflow
        :param tenant_id: Tenant ID for file reconstruction
        :param model_instance: Model instance for token counting
        """
        self.app_id = app_id
        self.conversation_id = conversation_id
        self.node_id = node_id
        self.tenant_id = tenant_id
        self.model_instance = model_instance
        self._storage_key = f"node_memory/{app_id}/{conversation_id}/{node_id}.json"
        self._data: NodeMemoryData | None = None
        self._dirty = False

    def _load(self) -> NodeMemoryData:
        """Load data from object storage."""
        if self._data is not None:
            return self._data

        try:
            raw = storage.load_once(self._storage_key)
            self._data = NodeMemoryData.model_validate_json(raw)
        except Exception:
            # File not found or parse error, start fresh
            self._data = NodeMemoryData()

        return self._data

    def _save(self) -> None:
        """Save data to object storage."""
        if self._data is not None:
            storage.save(self._storage_key, self._data.model_dump_json().encode("utf-8"))
            self._dirty = False

    def _file_to_memory_file(self, file: File) -> NodeMemoryFile:
        """Convert File object to NodeMemoryFile reference."""
        return NodeMemoryFile(
            type=file.type.value if hasattr(file.type, "value") else str(file.type),
            transfer_method=(
                file.transfer_method.value if hasattr(file.transfer_method, "value") else str(file.transfer_method)
            ),
            upload_file_id=file.related_id if file.transfer_method == FileTransferMethod.LOCAL_FILE else None,
            tool_file_id=file.related_id if file.transfer_method == FileTransferMethod.TOOL_FILE else None,
            url=file.remote_url if file.transfer_method == FileTransferMethod.REMOTE_URL else None,
        )

    def _memory_file_to_mapping(self, memory_file: NodeMemoryFile) -> dict:
        """Convert NodeMemoryFile to mapping for file_factory."""
        mapping: dict = {
            "type": memory_file.type,
            "transfer_method": memory_file.transfer_method,
        }
        if memory_file.upload_file_id:
            mapping["upload_file_id"] = memory_file.upload_file_id
        if memory_file.tool_file_id:
            mapping["tool_file_id"] = memory_file.tool_file_id
        if memory_file.url:
            mapping["url"] = memory_file.url
        return mapping

    def _rebuild_files(self, memory_files: list[NodeMemoryFile]) -> list[File]:
        """Rebuild File objects from NodeMemoryFile references."""
        if not memory_files:
            return []

        from factories import file_factory

        files = []
        for mf in memory_files:
            try:
                mapping = self._memory_file_to_mapping(mf)
                file = file_factory.build_from_mapping(mapping=mapping, tenant_id=self.tenant_id)
                files.append(file)
            except Exception as e:
                logger.warning("Failed to rebuild file from memory: %s", e)
                continue
        return files

    def _build_prompt_message(
        self,
        role: str,
        content: str,
        files: list[File],
        detail: ImagePromptMessageContent.DETAIL = ImagePromptMessageContent.DETAIL.HIGH,
    ) -> PromptMessage:
        """Build PromptMessage from content and files."""
        from core.file import file_manager

        if not files:
            if role == "user":
                return UserPromptMessage(content=content)
            else:
                return AssistantPromptMessage(content=content)

        # Build multimodal content
        prompt_contents: list = []
        for file in files:
            try:
                prompt_content = file_manager.to_prompt_message_content(file, image_detail_config=detail)
                prompt_contents.append(prompt_content)
            except Exception as e:
                logger.warning("Failed to convert file to prompt content: %s", e)
                continue

        prompt_contents.append(TextPromptMessageContent(data=content))

        if role == "user":
            return UserPromptMessage(content=prompt_contents)
        else:
            return AssistantPromptMessage(content=prompt_contents)

    def _get_thread_workflow_run_ids(self) -> list[str]:
        """
        Get workflow_run_ids for the current thread by querying Message table.

        Returns workflow_run_ids in chronological order (oldest first).
        """
        # Query messages for this conversation
        stmt = (
            select(Message).where(Message.conversation_id == self.conversation_id).order_by(Message.created_at.desc())
        )
        messages = db.session.scalars(stmt.limit(500)).all()

        if not messages:
            return []

        # Extract thread messages using existing logic
        thread_messages = extract_thread_messages(messages)

        # For newly created message, its answer is temporarily empty, skip it
        if thread_messages and not thread_messages[0].answer and thread_messages[0].answer_tokens == 0:
            thread_messages.pop(0)

        # Reverse to get chronological order, extract workflow_run_ids
        workflow_run_ids = []
        for msg in reversed(thread_messages):
            if msg.workflow_run_id:
                workflow_run_ids.append(msg.workflow_run_id)

        return workflow_run_ids

    def add_messages(
        self,
        workflow_run_id: str,
        user_content: str,
        user_files: Sequence[File] | None = None,
        assistant_content: str = "",
        assistant_files: Sequence[File] | None = None,
    ) -> None:
        """
        Add a dialogue turn to node memory.
        Call this after LLM node execution completes.

        :param workflow_run_id: Current workflow execution ID
        :param user_content: User's text input
        :param user_files: Files attached by user
        :param assistant_content: Assistant's text response
        :param assistant_files: Files generated by assistant
        """
        data = self._load()

        # Convert files to memory file references
        user_memory_files = [self._file_to_memory_file(f) for f in (user_files or [])]
        assistant_memory_files = [self._file_to_memory_file(f) for f in (assistant_files or [])]

        # Store the turn indexed by workflow_run_id
        data.turns[workflow_run_id] = NodeMemoryTurn(
            user_content=user_content,
            user_files=user_memory_files,
            assistant_content=assistant_content,
            assistant_files=assistant_memory_files,
        )

        self._dirty = True

    def get_history_prompt_messages(
        self,
        *,
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> Sequence[PromptMessage]:
        """
        Retrieve history as PromptMessage sequence.

        Thread tracking is handled by querying Message table's parent_message_id structure.

        :param max_token_limit: Maximum tokens for history
        :param message_limit: unused, for interface compatibility
        :return: Sequence of PromptMessage for LLM context
        """
        # message_limit is unused in NodeTokenBufferMemory (uses token limit instead)
        _ = message_limit
        detail = ImagePromptMessageContent.DETAIL.HIGH
        data = self._load()

        if not data.turns:
            return []

        # Get workflow_run_ids for current thread from Message table
        thread_workflow_run_ids = self._get_thread_workflow_run_ids()

        if not thread_workflow_run_ids:
            return []

        # Build prompt messages in thread order
        prompt_messages: list[PromptMessage] = []
        for wf_run_id in thread_workflow_run_ids:
            turn = data.turns.get(wf_run_id)
            if not turn:
                # This workflow execution didn't have node memory stored
                continue

            # Build user message
            user_files = self._rebuild_files(turn.user_files) if turn.user_files else []
            user_msg = self._build_prompt_message(
                role="user",
                content=turn.user_content,
                files=user_files,
                detail=detail,
            )
            prompt_messages.append(user_msg)

            # Build assistant message
            assistant_files = self._rebuild_files(turn.assistant_files) if turn.assistant_files else []
            assistant_msg = self._build_prompt_message(
                role="assistant",
                content=turn.assistant_content,
                files=assistant_files,
                detail=detail,
            )
            prompt_messages.append(assistant_msg)

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

    def flush(self) -> None:
        """
        Persist buffered changes to object storage.
        Call this at the end of node execution.
        """
        if self._dirty:
            self._save()

    def clear(self) -> None:
        """Clear all messages in this node's memory."""
        self._data = NodeMemoryData()
        self._save()

    def exists(self) -> bool:
        """Check if node memory exists in storage."""
        return storage.exists(self._storage_key)
