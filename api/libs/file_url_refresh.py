"""Refresh expiring signed file URLs embedded in persisted workflow payloads.

Node executions and workflow runs persist ``graphon`` ``File`` objects as JSON.
Each serialized file embeds a signed preview URL whose HMAC signature carries a
timestamp and stops being accepted after ``FILES_ACCESS_TIMEOUT`` seconds
(default 300). Replaying those stored payloads to the console log/trace views
therefore renders broken image previews for any run older than the signature
TTL. Re-signing at response time gives every viewer a fresh, valid preview URL
without touching the persisted data.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from graphon.file import helpers as file_helpers
from graphon.file.constants import FILE_MODEL_IDENTITY
from models.utils.file_input_compat import resolve_file_record_id

logger = logging.getLogger(__name__)

_LOCAL_FILE = "local_file"
_TOOL_FILE = "tool_file"


def _normalize_extension(extension: object) -> str:
    if not isinstance(extension, str) or not extension.strip("."):
        return ".bin"
    return extension if extension.startswith(".") else f".{extension}"


def _resolve_record_id(file_mapping: Mapping[str, Any]) -> str | None:
    record_id = resolve_file_record_id(file_mapping)
    if record_id:
        return record_id
    fallback = file_mapping.get("upload_file_id") or file_mapping.get("tool_file_id")
    return fallback if isinstance(fallback, str) and fallback else None


def _refresh_file_mapping(file_mapping: Mapping[str, Any]) -> Mapping[str, Any]:
    """Re-sign the preview URL of one serialized ``File`` object.

    The HMAC signature is the only credential the ``/files`` delivery endpoints
    check, so refreshing it only needs the backing record id — no tenant or
    session context.
    """
    record_id = _resolve_record_id(file_mapping)
    if not record_id:
        return dict(file_mapping)

    transfer_method = file_mapping.get("transfer_method")
    transfer_method_value = getattr(transfer_method, "value", transfer_method)
    match transfer_method_value:
        case "local_file":
            url = file_helpers.get_signed_file_url(upload_file_id=record_id)
        case "tool_file":
            url = file_helpers.get_signed_tool_file_url(
                tool_file_id=record_id,
                extension=_normalize_extension(file_mapping.get("extension")),
            )
        case _:
            # remote_url files keep their external absolute URL, and datasource
            # files have no browser-facing delivery endpoint.
            return dict(file_mapping)

    refreshed = dict(file_mapping)
    refreshed["url"] = url
    return refreshed


def refresh_file_urls(value: Any) -> Any:
    """Recursively refresh signed preview URLs of serialized file objects.

    File objects are recognized by their ``dify_model_identity`` marker, the
    same convention used when persisting file variables. Any structure may be
    passed in; non-file values are returned unchanged. A file whose URL cannot
    be re-signed (e.g. no resolvable record id) is kept as-is so the endpoint
    degrades to the previous behavior instead of failing.
    """
    if isinstance(value, Mapping):
        if value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
            try:
                return _refresh_file_mapping(value)
            except (TypeError, ValueError, RuntimeError) as caught_error:
                logger.warning("Failed to refresh signed file url: %s", caught_error)
                return dict(value)
        return {key: refresh_file_urls(item) for key, item in value.items()}
    if isinstance(value, list):
        return [refresh_file_urls(item) for item in value]
    return value
