from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, RootModel, field_validator


def _mask_api_key(value: str | None) -> str | None:
    if value is None:
        return None
    if value == "":
        return value
    if len(value) <= 8:
        return value[0] + "******" + value[-1]
    return value[:3] + "******" + value[-3:]


def _to_timestamp(value: datetime | int | None) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return value


class ResponseModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
        populate_by_name=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )


class APIBasedExtensionResponse(ResponseModel):
    id: str
    name: str
    api_endpoint: str
    api_key: str | None = None
    created_at: int | None = None

    @field_validator("api_key", mode="before")
    @classmethod
    def _normalize_api_key(cls, value: str | None) -> str | None:
        return _mask_api_key(value)

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class APIBasedExtensionList(RootModel[list[APIBasedExtensionResponse]]):
    pass
