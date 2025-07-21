from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from libs.uuid_utils import uuidv7


class StateVersion(StrEnum):
    # `V1` is `GraphRuntimeState` serialized as JSON by dumping with Pydantic.
    V1 = "v1"


class WorkflowSuspension(BaseModel):
    id: UUID = Field(default_factory=uuidv7)

    # Correspond to WorkflowExecution.id_
    execution_id: str

    workflow_id: str

    next_node_id: str

    state: str

    state_version: StateVersion = StateVersion.V1

    inputs: str
