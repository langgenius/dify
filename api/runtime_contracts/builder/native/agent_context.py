"""Server-carried confirmed Agent references; decoding grants no execution authority."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator

from runtime_contracts.builder.native.contracts import FrozenDTO, NativeTestContextRef


class BuilderAgentExecutionContext(FrozenDTO):
    schema_version: Literal["builder-agent-confirmed-v1"] = "builder-agent-confirmed-v1"
    ref: NativeTestContextRef
    native_run_id: Annotated[str, Field(strict=True)]

    @field_validator("native_run_id")
    @classmethod
    def canonical_run_id(cls, value: str) -> str:
        if str(UUID(value)) != value:
            raise ValueError("native_run_id must be a canonical UUID string")
        return value
