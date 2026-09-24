"""Response contracts shared by Console API key endpoints."""

from collections.abc import Iterable, Mapping
from datetime import datetime

from pydantic import field_validator

from fields.base import ResponseModel
from libs.helper import to_timestamp


class ApiKeyItem(ResponseModel):
    id: str
    type: str
    token: str
    # Dataset keys only: the knowledge bases this key is bound to. Empty = the key can
    # access every dataset in the tenant (default). App keys are always empty.
    dataset_ids: list[str] = []
    last_used_at: int | None = None
    created_at: int | None = None

    @field_validator("last_used_at", "created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ApiKeyList(ResponseModel):
    data: list[ApiKeyItem]


def mask_api_token(token: str) -> str:
    """Mask a secret token for list responses.

    Reveal-once: the full secret is only returned by the create endpoint. List
    endpoints expose just enough (prefix + last 4) to identify a key, never the
    full value, so an existing key's secret cannot be retrieved after creation.
    """
    if len(token) <= 8:
        return "***"
    return f"{token[:5]}...{token[-4:]}"


def build_masked_api_key_list(
    api_tokens: Iterable[object],
    bindings_by_token: Mapping[str, list[str]] | None = None,
) -> ApiKeyList:
    """Build an ApiKeyList from token records with their secrets masked.

    ``bindings_by_token`` maps an api_token id to the dataset ids it is bound to
    (from DatasetApiTokenBinding); tokens absent from the map are unbound (empty =
    access all). When omitted, preserve the scope carried by the records.
    """
    items: list[ApiKeyItem] = []
    for api_token in api_tokens:
        item = ApiKeyItem.model_validate(api_token, from_attributes=True)
        item.token = mask_api_token(item.token)
        if bindings_by_token is not None:
            item.dataset_ids = bindings_by_token.get(item.id, [])
        items.append(item)
    return ApiKeyList(data=items)
