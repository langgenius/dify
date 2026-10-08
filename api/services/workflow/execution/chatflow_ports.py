"""Persistence and execution capabilities consumed by Chatflow adapters."""

from collections.abc import Sequence
from typing import Protocol

from graphon.variables import Variable
from graphon.variables.variables import VariableBase
from models.annotation_reply import AnnotationReplies
from services.app.generation.ports import ChatRecords
from services.workflow.execution.ports import WorkflowRuntime


class ChatflowRecords(ChatRecords, Protocol):
    def dialogue_count(self, conversation_id: str) -> int: ...


class ConversationVariableWriter(Protocol):
    def update(self, conversation_id: str, variable: VariableBase) -> None: ...


class ConversationVariables(ConversationVariableWriter, Protocol):
    def initialize(self, *, app_id: str, conversation_id: str, defaults: Sequence[VariableBase]) -> list[Variable]: ...


class ChatflowRuntime(WorkflowRuntime, Protocol):
    @property
    def chat_records(self) -> ChatflowRecords: ...
    @property
    def annotation_replies(self) -> AnnotationReplies: ...
    @property
    def conversation_variables(self) -> ConversationVariables: ...
