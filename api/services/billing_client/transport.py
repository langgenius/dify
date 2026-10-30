"""HTTP transport shared by the generated billing and saas operations.

Reuses the pooled client, auth header, and connection retry of `services.billing_service`.
Network failures, timeouts, throttling, and 5xx raise `BillingUpstreamUnavailableError`;
any other non-200 status or a body that fails model validation raises
`BillingUpstreamInvalidResponseError`.
"""

import os
from collections.abc import Mapping
from enum import StrEnum
from typing import Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError
from tenacity import retry, retry_if_exception_type, stop_before_delay, wait_fixed

from core.helper.http_client_pooling import get_pooled_http_client
from services.errors.billing import BillingUpstreamInvalidResponseError, BillingUpstreamUnavailableError

type HTTPMethod = Literal["GET", "POST", "PUT", "DELETE"]
type QueryValue = str | int | float | bool | list[str]

_http_client: httpx.Client = get_pooled_http_client(
    "billing:default",
    lambda: httpx.Client(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
    ),
)

_UNAVAILABLE_STATUSES = frozenset({httpx.codes.REQUEST_TIMEOUT, httpx.codes.TOO_MANY_REQUESTS})


class Upstream(StrEnum):
    BILLING = "billing"
    BILLING_QUOTA = "billing_quota"
    SAAS = "saas"


class BillingModel(BaseModel):
    """Base for generated models; unknown upstream fields are ignored and int64 strings coerce to int."""

    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)


def _base_url(upstream: Upstream) -> str:
    billing_url = os.environ.get("BILLING_API_URL", "BILLING_API_URL")
    if upstream == Upstream.BILLING_QUOTA:
        return os.environ.get("BILLING_QUOTA_API_URL") or billing_url
    return billing_url


@retry(
    wait=wait_fixed(2),
    stop=stop_before_delay(10),
    retry=retry_if_exception_type(httpx.RequestError),
    reraise=True,
)
def _send(method: HTTPMethod, url: str, *, params: Mapping[str, QueryValue], json: object | None) -> httpx.Response:
    headers = {
        "Content-Type": "application/json",
        "Billing-Api-Secret-Key": os.environ.get("BILLING_API_SECRET_KEY", "BILLING_API_SECRET_KEY"),
    }
    return _http_client.request(method, url, params=params, json=json, headers=headers, follow_redirects=True)


def request[ResponseT: BillingModel](
    upstream: Upstream,
    method: HTTPMethod,
    path: str,
    *,
    response_model: type[ResponseT],
    path_params: Mapping[str, str],
    params: Mapping[str, QueryValue],
    body: BillingModel | None,
) -> ResponseT:
    resolved_path = path.format_map({name: quote(value, safe="") for name, value in path_params.items()})
    url = f"{_base_url(upstream)}{resolved_path}"
    json = body.model_dump(mode="json") if body is not None else None
    try:
        response = _send(method, url, params=params, json=json)
    except httpx.RequestError as error:
        raise BillingUpstreamUnavailableError(f"{method} {path} failed") from error

    if response.status_code != httpx.codes.OK:
        message = f"{method} {path} returned {response.status_code}"
        if response.status_code in _UNAVAILABLE_STATUSES or response.status_code >= 500:
            raise BillingUpstreamUnavailableError(message)
        raise BillingUpstreamInvalidResponseError(message)

    try:
        return response_model.model_validate_json(response.content)
    except ValidationError as error:
        raise BillingUpstreamInvalidResponseError(f"{method} {path} returned an invalid body") from error
