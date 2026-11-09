"""Tasks consumed by Engine ready queue implementations."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from graphon.nodes.container_effects import ContainerRunResult


class StartTask(BaseModel):
    """Task that starts a node invocation inside an execution frame."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["start"] = "start"
    frame_id: str
    node_id: str


class ResumeTask(BaseModel):
    """Task that resumes a suspended node invocation."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["resume"] = "resume"
    invocation_id: str
    result: ContainerRunResult


ReadyTask = Annotated[StartTask | ResumeTask, Field(discriminator="kind")]
