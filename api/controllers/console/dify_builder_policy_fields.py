"""Safe Workspace policy DTOs: native references and ordinary generation controls."""

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints, model_validator

from fields.base import ResponseModel
from runtime_contracts.builder.string_enum import BuilderStringEnum
from services.dify_builder.application.cognition_policy import (
    CognitionModel,
    CognitionModelHealth,
    CognitionPolicy,
    CognitionPolicySource,
)


class CognitionModelMode(BuilderStringEnum):
    CHAT = "chat"
    COMPLETION = "completion"


class CognitionPolicyReason(BuilderStringEnum):
    BUILDER_DISABLED = "builder_disabled"
    MODEL_UNAVAILABLE = "model_unavailable"
    MODEL_AVAILABILITY_UNKNOWN = "model_availability_unknown"


Reference = Annotated[str, StringConstraints(min_length=1, max_length=255)]


class CognitionModelPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Reference
    provider: Reference
    name: Reference
    mode: CognitionModelMode
    completion_params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_parameters(self):
        CognitionModel(**self.model_dump())
        return self


class DifyBuilderPolicyPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Annotated[StrictInt, Field(ge=0)]
    enabled: StrictBool
    models: Annotated[list[CognitionModelPayload], Field(max_length=20)]
    default_model_id: Reference | None
    fallback_model_ids: Annotated[list[Reference], Field(max_length=19)] = Field(default_factory=list)

    def policy(self) -> CognitionPolicy:
        return CognitionPolicy(
            self.enabled,
            tuple(CognitionModel(**m.model_dump()) for m in self.models),
            self.default_model_id,
            tuple(self.fallback_model_ids),
            0,
            CognitionPolicySource.EXPLICIT,
        )


class CognitionModelResponse(ResponseModel):
    id: str
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any]
    health: CognitionModelHealth


class DifyBuilderPolicyResponse(ResponseModel):
    enabled: bool
    models: list[CognitionModelResponse]
    default_model_id: str | None
    fallback_model_ids: list[str]
    revision: int
    source: CognitionPolicySource
    available: bool
    reason_code: CognitionPolicyReason | None


class DifyBuilderAvailabilityResponse(DifyBuilderPolicyResponse):
    """The same safe availability projection after App-scoped admission."""
