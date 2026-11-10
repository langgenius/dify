"""Safe Workspace policy DTOs: native references and ordinary generation controls."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints, model_validator

from fields.base import ResponseModel
from services.dify_builder.application.cognition_policy import CognitionModel, CognitionPolicy

Reference = Annotated[str, StringConstraints(min_length=1, max_length=255)]


class CognitionModelPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Reference
    provider: Reference
    name: Reference
    mode: Literal["chat", "completion"]
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
            "explicit",
        )


class CognitionModelResponse(ResponseModel):
    id: str
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any]
    health: Literal["configured", "unavailable", "unknown"]


class DifyBuilderPolicyResponse(ResponseModel):
    enabled: bool
    models: list[CognitionModelResponse]
    default_model_id: str | None
    fallback_model_ids: list[str]
    revision: int
    source: Literal["explicit", "workspace_default"]
    available: bool
    reason_code: Literal["builder_disabled", "model_unavailable", "model_availability_unknown"] | None


class DifyBuilderAvailabilityResponse(DifyBuilderPolicyResponse):
    """The same safe availability projection after App-scoped admission."""
