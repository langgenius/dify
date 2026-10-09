"""Message persistence operations required by application generation.

Repositories implement these protocols with short, owned transactions. Execution
dependencies belong to the runtime contracts, not to this persistence interface.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMUsage
from models.enums import MessageStatus
from models.model import (
    AnnotationReplyConfig,
    App,
    AppMode,
    AppModelConfig,
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageFile,
    UploadFile,
)
from models.workflow import Workflow


@dataclass(frozen=True)
class ChatRecordSeed:
    conversation: Mapping[str, Any]
    message: Mapping[str, Any]
    files: Sequence[Mapping[str, Any]]


@dataclass(frozen=True, slots=True)
class WorkflowSnapshot:
    id: str
    tenant_id: str
    features_dict: Mapping[str, Any]

    @classmethod
    def from_workflow(cls, workflow: Workflow) -> "WorkflowSnapshot":
        return cls(
            id=workflow.id,
            tenant_id=workflow.tenant_id,
            features_dict=dict(workflow.features_dict),
        )


@dataclass(frozen=True, slots=True)
class ConversationSnapshot:
    id: str
    mode: AppMode

    @classmethod
    def from_conversation(cls, conversation: Conversation) -> "ConversationSnapshot":
        return cls(
            id=conversation.id,
            mode=conversation.mode,
        )


@dataclass(frozen=True, slots=True)
class MessageSnapshot:
    id: str
    query: str
    created_at: datetime
    status: MessageStatus
    answer: str

    @classmethod
    def from_message(cls, message: Message) -> "MessageSnapshot":
        return cls(
            id=message.id,
            query=message.query,
            created_at=message.created_at,
            status=message.status,
            answer=message.answer,
        )


@dataclass(frozen=True)
class MessageIdentity:
    tenant_id: str
    app_id: str
    conversation_id: str
    message_id: str


@dataclass(frozen=True)
class MessageUpdate:
    answer: str
    latency: float
    metadata: Mapping[str, Any]
    files: Sequence[Mapping[str, Any]]
    usage: LLMUsage | None
    paused: bool = False
    prompt: Sequence[Mapping[str, Any]] | None = None
    preserve_existing_usage: bool = False


@dataclass(frozen=True)
class AgentHistoryMessage:
    message: Message
    thoughts: list[MessageAgentThought]
    files: list[MessageFile]
    model_config: Mapping[str, Any] | None


class MessageFileWriter(Protocol):
    def create_message_files(
        self, *, tenant_id: str, message_id: str, files: Sequence[Mapping[str, Any]]
    ) -> list[str]: ...


class AgentMessageRecords(MessageFileWriter, Protocol):
    def image_uploads(self, *, tenant_id: str, upload_ids: Sequence[str]) -> list[File]: ...

    def agent_history(self, identity: MessageIdentity) -> list[AgentHistoryMessage]: ...

    def save_usage(self, identity: MessageIdentity, usage: LLMUsage) -> None: ...

    def create_agent_thought(self, identity: MessageIdentity, fields: Mapping[str, Any]) -> str: ...

    def update_agent_thought(
        self, identity: MessageIdentity, thought_id: str, *, values: Mapping[str, Any], deltas: Mapping[str, str]
    ) -> None: ...

    def delete_agent_thought(self, identity: MessageIdentity, thought_id: str) -> None: ...

    def agent_thought(self, identity: MessageIdentity, thought_id: str) -> MessageAgentThought | None: ...


class MessageCycleRecords(Protocol):
    def annotation_reply(
        self, *, tenant_id: str, app_id: str, annotation_id: str
    ) -> tuple[MessageAnnotation, str | None] | None: ...

    def has_assistant_files(self, *, tenant_id: str, app_id: str, message_id: str) -> bool: ...

    def message_file(self, *, tenant_id: str, app_id: str, file_id: str) -> MessageFile | None: ...

    def conversation_snapshot(
        self, *, tenant_id: str, app_id: str, conversation_id: str
    ) -> ConversationSnapshot | None: ...

    def rename_conversation(self, *, tenant_id: str, app_id: str, conversation_id: str, name: str) -> None: ...


class MessagePipelineRecords(MessageCycleRecords, Protocol):
    def message_files(self, identity: MessageIdentity) -> tuple[list[MessageFile], dict[str, UploadFile]]: ...

    def save_message(self, identity: MessageIdentity, update: MessageUpdate) -> Message: ...

    def fail_message(self, identity: MessageIdentity, error: str) -> None: ...

    def agent_thought(self, identity: MessageIdentity, thought_id: str) -> MessageAgentThought | None: ...

    def attach_workflow(self, identity: MessageIdentity, workflow_run_id: str) -> None: ...

    def record_human_input(
        self, identity: MessageIdentity, *, workflow_run_id: str, form_id: str | None, node_id: str | None
    ) -> None: ...


class ChatRecords(AgentMessageRecords, MessagePipelineRecords, Protocol):
    def regeneration_message(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        account_id: str | None,
        end_user_id: str | None,
    ) -> tuple[Conversation, Message, dict[str, Any]]: ...

    def latest_query(self, *, tenant_id: str, app_id: str, conversation_id: str) -> str | None: ...

    def model_config(self, *, tenant_id: str, app_id: str, config_id: str | None) -> AppModelConfig: ...

    def annotation_config(self, *, tenant_id: str, app_id: str) -> AnnotationReplyConfig: ...

    def conversation(
        self, *, app_id: str, conversation_id: str, account_id: str | None, end_user_id: str | None
    ) -> Conversation: ...

    def initialize(
        self, *, tenant_id: str, app_id: str, conversation_id: str | None, seed: ChatRecordSeed
    ) -> tuple[Conversation, Message]: ...

    def load(
        self, *, tenant_id: str, app_id: str, conversation_id: str, message_id: str
    ) -> tuple[App, Conversation, Message]: ...
