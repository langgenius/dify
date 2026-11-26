"""Bounded identifiers and immutable Builder data records."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict

from runtime_contracts.builder.execution import BoundedID, canonical_json


def _utf8(value: str) -> str:
    canonical_json(value)
    return value


ID = Annotated[BoundedID, AfterValidator(_utf8)]


class FrozenDTO(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)
