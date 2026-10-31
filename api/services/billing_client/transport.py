"""HTTP transport shared by the generated billing and saas operations.

This is the only module that reads the billing URLs and secret, and only the generated modules
call `request`; ruff's banned-api rule (TID251) rejects both anywhere else.
Network failures, timeouts, throttling, and 5xx raise the service's `UpstreamUnavailableError`
(a `BillingUpstreamUnavailableError`); any other non-200 status or an enforced response that
fails model validation raises its `UpstreamInvalidResponseError` (a
`BillingUpstreamInvalidResponseError`). Each generated module passes its own error types in
`ServiceErrors`. For a non-200 status, the error carries the status code, the parsed Kratos
error body, and its reason typed by the service's generated `ErrorReason`. A reason outside it
is kept as `UnknownErrorReason` and logged with `logger.error` (reported to Sentry): the service
shipped a reason before this client was regenerated. Callers map reasons to their own errors;
this module branches on none.

Response validation is observed before it is enforced. For a path not in
`ENFORCED_RESPONSE_PATHS`, a body that fails validation is logged with `logger.exception`
(reported to Sentry) and rebuilt from the raw payload: fields that validate are coerced,
the rest keep their raw value, and missing fields read as `None`. Migrated single-response
reads and quota operations are enforced before their results reach business decisions.
Batch subscription plans remain observed here; `BillingService.get_plan_bulk` validates
each item before returning it.
"""

import json
import logging
import re
import types
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from functools import cache
from typing import Any, Literal, Union, get_args, get_origin
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError
from tenacity import retry, retry_if_exception_type, stop_before_delay, wait_fixed

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client
from services.errors.billing import (
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
    UnknownErrorReason,
    UpstreamErrorBody,
)

logger = logging.getLogger(__name__)

ENFORCED_RESPONSE_PATHS: frozenset[str] = frozenset(
    {
        "/subscription/info",
        "/subscription/vector-space",
        "/subscription/knowledge-rate-limit",
        "/subscription/payment-link",
        "/subscription/cleanup/whitelist",
        "/model-provider/payment-link",
        "/invoices",
        "/compliance/download",
        "/quota/info",
        "/quota/reserve",
        "/quota/commit",
        "/quota/release",
        "/quota/balance",
        "/quota/consume-capped",
        # A salvaged `status` or `expire_at` would misreport eligibility or break the expiry timestamp.
        "/education/verify",
        "/education/status",
        # Network access replies already required validation and gate access control.
        "/tenants/{tenant_id}/network-access-groups",
        "/tenants/{tenant_id}/network-access-groups/{group_id}",
        "/tenants/{tenant_id}/apps/{app_id}/network-access-group",
        "/tenants/{tenant_id}/apps/{app_id}/network-access-group/status",
        "/tenants/{tenant_id}/apps/{app_id}/network-access-group-binding",
    }
)

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
_NON_REASON_CHARACTERS = re.compile(r"[^A-Z0-9_]")


class Upstream(StrEnum):
    BILLING = "billing"
    BILLING_QUOTA = "billing_quota"
    SAAS = "saas"
    NETWORK_ACCESS = "network_access"


@dataclass(frozen=True)
class ServiceErrors:
    """The reason guard and error types of one generated service module, which raises through them."""

    is_reason: Callable[[str], bool]
    unavailable: Callable[..., BillingUpstreamUnavailableError]
    invalid_response: Callable[..., BillingUpstreamInvalidResponseError]


class BillingModel(BaseModel):
    """Base for generated models; unknown upstream fields are ignored and int64 strings coerce to int."""

    model_config = ConfigDict(extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)


def _base_url(upstream: Upstream) -> str:
    billing_url = dify_config.BILLING_API_URL
    if upstream == Upstream.BILLING_QUOTA:
        return dify_config.BILLING_QUOTA_API_URL or billing_url
    if upstream == Upstream.NETWORK_ACCESS:
        return (dify_config.NETWORK_ACCESS_API_URL.strip() or billing_url).rstrip("/")
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
        "Billing-Api-Secret-Key": dify_config.BILLING_API_SECRET_KEY,
    }
    return _http_client.request(method, url, params=params, json=json, headers=headers, follow_redirects=True)


def request[ResponseT: BillingModel](
    upstream: Upstream,
    method: HTTPMethod,
    path: str,
    *,
    response_model: type[ResponseT],
    errors: ServiceErrors,
    path_params: Mapping[str, str],
    params: Mapping[str, QueryValue],
    body: BillingModel | None,
) -> ResponseT:
    resolved_path = path.format_map({name: quote(value, safe="") for name, value in path_params.items()})
    url = f"{_base_url(upstream)}{resolved_path}"
    request_json = body.model_dump(mode="json") if body is not None else None
    try:
        response = _send(method, url, params=params, json=request_json)
    except httpx.RequestError as error:
        raise errors.unavailable(f"{method} {path} failed") from error

    if response.status_code != httpx.codes.OK:
        message = f"{method} {path} returned {response.status_code}"
        status_code = response.status_code
        error_body, reason = _error_details(response, errors.is_reason, upstream, method, path)
        error_type = (
            errors.unavailable
            if status_code in _UNAVAILABLE_STATUSES or status_code >= 500
            else errors.invalid_response
        )
        raise error_type(message, status_code=status_code, body=error_body, reason=reason)

    invalid_body = f"{method} {path} returned an invalid body"
    try:
        payload = json.loads(response.content)
    except ValueError as error:
        raise errors.invalid_response(invalid_body) from error
    try:
        return response_model.model_validate(payload)
    except ValidationError as error:
        if path in ENFORCED_RESPONSE_PATHS or not isinstance(payload, dict):
            raise errors.invalid_response(invalid_body) from error
        logger.exception("Billing response failed validation: %s %s", method, path)
        return _salvage_model(response_model, payload)


def _error_details(
    response: httpx.Response, is_reason: Callable[[str], bool], upstream: Upstream, method: HTTPMethod, path: str
) -> tuple[UpstreamErrorBody | None, str | UnknownErrorReason | None]:
    try:
        payload = json.loads(response.content)
    except ValueError:
        return None, None
    if not isinstance(payload, dict):
        return None, None
    body, reason = UpstreamErrorBody.model_validate(payload), payload.get("reason")
    if not isinstance(reason, str):
        return body, None
    if is_reason(reason):
        return body, reason
    logger.error(
        "Unknown %s error reason %s from %s %s; regenerate the billing client",
        upstream,
        _NON_REASON_CHARACTERS.sub("", reason)[:64],
        method,
        path,
    )
    return body, UnknownErrorReason(reason)


def _salvage_model[ModelT: BillingModel](model: type[ModelT], payload: Mapping[str, Any]) -> ModelT:
    values: dict[str, Any] = {}
    for name, field in model.model_fields.items():
        wire_name = field.alias or name
        raw = payload.get(wire_name, payload.get(name))
        values[name] = _salvage_value(field.annotation, raw)
    return model.model_construct(**values)


def _salvage_value(annotation: Any, raw: object) -> object:
    if raw is None:
        return None
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        annotation = next(arg for arg in get_args(annotation) if arg is not type(None))
        origin = get_origin(annotation)
    if isinstance(annotation, type) and issubclass(annotation, BillingModel) and isinstance(raw, Mapping):
        return _salvage_model(annotation, raw)
    if origin is dict and isinstance(raw, Mapping):
        value_type = get_args(annotation)[1]
        return {key: _salvage_value(value_type, value) for key, value in raw.items()}
    if origin is list and isinstance(raw, list):
        item_type = get_args(annotation)[0]
        return [_salvage_value(item_type, item) for item in raw]
    try:
        return _adapter(annotation).validate_python(raw)
    except ValidationError:
        return raw


@cache
def _adapter(annotation: Any) -> TypeAdapter[Any]:
    return TypeAdapter(annotation)
