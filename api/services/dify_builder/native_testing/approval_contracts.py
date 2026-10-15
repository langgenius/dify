"""Immutable protected proposals, shared by journal producer and public disclosure."""

from typing import Annotated, Self

from pydantic import Field, model_validator

from services.dify_builder.native_testing.contracts import Counter, FrozenDTO, OperationKey, UTCTimestamp


class NativeApprovalTerms(FrozenDTO):
    max_calls: Annotated[Counter, Field(ge=1)]
    max_dispatches: Annotated[Counter, Field(ge=1)]
    max_cost_units: Counter
    expires_at: UTCTimestamp

    @model_validator(mode="after")
    def validate_counts(self) -> Self:
        if self.max_dispatches < self.max_calls:
            raise ValueError("dispatch bound must cover logical call bound")
        return self


class NativeApprovalProposal(FrozenDTO):
    key: OperationKey
    terms: NativeApprovalTerms
