from dataclasses import dataclass
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from graphon.engine.filter import ResponseStreamFilter
from models.model import AppMode


# Wrapper types for `WorkflowAppGenerateEntity` and
# `AdvancedChatAppGenerateEntity`. These wrappers enable type discrimination
# and correct reconstruction of the entity field during (de)serialization.
class _WorkflowGenerateEntityWrapper(BaseModel):
    type: Literal[AppMode.WORKFLOW] = AppMode.WORKFLOW
    entity: WorkflowAppGenerateEntity


class _AdvancedChatAppGenerateEntityWrapper(BaseModel):
    type: Literal[AppMode.ADVANCED_CHAT] = AppMode.ADVANCED_CHAT
    entity: AdvancedChatAppGenerateEntity


type _GenerateEntityUnion = Annotated[
    _WorkflowGenerateEntityWrapper | _AdvancedChatAppGenerateEntityWrapper,
    Field(discriminator="type"),
]


class WorkflowResumptionContext(BaseModel):
    """WorkflowResumptionContext captures all state necessary for resumption."""

    version: Literal["1"] = "1"

    # Only workflow / chatflow could be paused.
    generate_entity: _GenerateEntityUnion
    serialized_graph_runtime_state: str
    # Optional so that a workflow run paused before this field existed still
    # loads: it just degrades to fresh-filter behavior on resume for that one
    # stale run.
    serialized_response_stream_filter_state: str | None = None

    def dumps(self) -> str:
        return self.model_dump_json()

    @classmethod
    def loads(cls, value: str) -> Self:
        return cls.model_validate_json(value)

    def get_generate_entity(self) -> WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity:
        return self.generate_entity.entity

    def get_response_stream_filter(self) -> ResponseStreamFilter:
        response_stream_filter = ResponseStreamFilter()
        if self.serialized_response_stream_filter_state is not None:
            response_stream_filter.loads(self.serialized_response_stream_filter_state)
        return response_stream_filter


@dataclass(frozen=True)
class PauseStateLayerConfig:
    """Persistence configuration for resumable workflow runs."""

    session_factory: Engine | sessionmaker[Session]
    state_owner_user_id: str
