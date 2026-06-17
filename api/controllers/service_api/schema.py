"""Service API OpenAPI documentation helpers.

These helpers keep documentation-only request shapes next to controller
definitions without changing the Pydantic models used for runtime validation.
"""

from __future__ import annotations

from collections.abc import Sequence
from copy import deepcopy
from typing import cast

from flask_restx import Namespace
from pydantic import BaseModel

USER_PROPERTY_SCHEMA: dict[str, object] = {"description": "End user identifier", "type": "string"}
USER_QUERY_PARAM: dict[str, object] = {"description": "End user identifier", "in": "query", "type": "string"}
USER_FORM_PARAM: dict[str, object] = {"description": "End user identifier", "in": "formData", "type": "string"}
FILE_FORM_PARAM: dict[str, object] = {"in": "formData", "required": True, "type": "file"}
USER_FETCH_FROM_ATTR = "_dify_service_api_user_fetch_from"
USER_REQUIRED_ATTR = "_dify_service_api_user_required"
JSON_USER_FETCH_FROM = "JSON"


def expect_with_user(namespace: Namespace, model: type[BaseModel]):
    """Document a JSON request body as ``model`` plus Service API ``user``."""

    source_model = namespace.models[model.__name__]
    model_name = f"{model.__name__}WithUser"

    def decorator(view_func):
        required = _json_user_required(view_func)
        schema = cast(dict[str, object], deepcopy(source_model.__schema__))
        _add_user_property(schema, required=required)
        if model_name not in namespace.models:
            namespace.schema_model(model_name, schema)
        return namespace.expect(namespace.models[model_name], validate=False)(view_func)

    return decorator


def expect_user_json(namespace: Namespace):
    """Document a JSON request body that only carries the Service API ``user``."""

    def decorator(view_func):
        required = _json_user_required(view_func)
        schema: dict[str, object] = {"properties": {}, "title": "ServiceApiUserPayload", "type": "object"}
        _add_user_property(schema, required=required)
        model_name = "RequiredServiceApiUserPayload" if required else "OptionalServiceApiUserPayload"
        if model_name not in namespace.models:
            namespace.schema_model(model_name, schema)
        return namespace.expect(namespace.models[model_name], validate=False)(view_func)

    return decorator


def multipart_file_params(*, include_user: bool) -> dict[str, dict[str, object]]:
    params: dict[str, dict[str, object]] = {"file": FILE_FORM_PARAM}
    if include_user:
        params["user"] = USER_FORM_PARAM
    return deepcopy(params)


def json_or_event_stream_response(namespace: Namespace):
    return namespace.doc(produces=["application/json", "text/event-stream"])


def event_stream_response(namespace: Namespace):
    return namespace.doc(produces=["text/event-stream"])


def binary_response(namespace: Namespace, media_type: str | Sequence[str]):
    media_types = [media_type] if isinstance(media_type, str) else list(media_type)
    return namespace.doc(produces=media_types)


def _json_user_required(view_func) -> bool:
    fetch_from = getattr(view_func, USER_FETCH_FROM_ATTR, None)
    if fetch_from != JSON_USER_FETCH_FROM:
        raise ValueError("JSON user documentation must match validate_app_token(fetch_user_arg=WhereisUserArg.JSON)")

    return bool(getattr(view_func, USER_REQUIRED_ATTR, False))


def _add_user_property(schema: dict[str, object], *, required: bool) -> None:
    variants: list[dict[str, object]] = []
    for keyword in ("anyOf", "oneOf"):
        candidates = schema.get(keyword)
        if isinstance(candidates, list):
            variants.extend(candidate for candidate in candidates if isinstance(candidate, dict))

    if variants:
        for variant in variants:
            _add_user_property_to_object_schema(variant, required=required)

    _add_user_property_to_object_schema(schema, required=required)


def _add_user_property_to_object_schema(schema: dict[str, object], *, required: bool) -> None:
    properties = schema.setdefault("properties", {})
    if isinstance(properties, dict):
        cast(dict[str, object], properties)["user"] = USER_PROPERTY_SCHEMA

    if required:
        required_fields = schema.setdefault("required", [])
        if isinstance(required_fields, list) and "user" not in required_fields:
            required_fields.append("user")
    else:
        required_fields = schema.get("required")
        if isinstance(required_fields, list) and "user" in required_fields:
            required_fields.remove("user")
        if required_fields == []:
            schema.pop("required", None)
