"""Service API OpenAPI documentation helpers.

These helpers keep documentation-only request shapes next to controller
definitions without changing the Pydantic models used for runtime validation.
"""

from __future__ import annotations

from collections.abc import Sequence
from copy import deepcopy
from typing import Annotated, Any, cast

from flask_restx import Namespace
from pydantic import BaseModel, WithJsonSchema

USER_DESCRIPTION = (
    "User identifier, unique within the application. This identifier scopes data access; resources created with "
    "one `user` value are only visible when queried with the same `user` value."
)
USER_PROPERTY_SCHEMA: dict[str, object] = {"description": USER_DESCRIPTION, "type": "string"}
USER_QUERY_PARAM: dict[str, object] = {
    "description": "User identifier, used for end-user context.",
    "in": "query",
    "type": "string",
}
USER_FORM_PARAM: dict[str, object] = {
    "description": USER_DESCRIPTION,
    "in": "formData",
    "type": "string",
}
FILE_FORM_PARAM: dict[str, object] = {
    "description": "The file to upload.",
    "in": "formData",
    "required": True,
    "type": "file",
}
USER_FETCH_FROM_ATTR = "_dify_service_api_user_fetch_from"
USER_REQUIRED_ATTR = "_dify_service_api_user_required"
JSON_USER_FETCH_FROM = "JSON"

INPUT_FILE_ITEM_SCHEMA: dict[str, object] = {
    "type": "object",
    "required": ["type", "transfer_method"],
    "properties": {
        "type": {
            "description": "File type.",
            "enum": ["document", "image", "audio", "video", "custom"],
            "type": "string",
        },
        "transfer_method": {
            "description": "Transfer method: `remote_url` for file URL, `local_file` for uploaded file.",
            "enum": ["remote_url", "local_file"],
            "type": "string",
        },
        "url": {
            "description": "File URL when `transfer_method` is `remote_url`.",
            "format": "url",
            "type": "string",
        },
        "upload_file_id": {
            "description": (
                "Uploaded file ID obtained from the [Upload File](/api-reference/files/upload-file) API when "
                "`transfer_method` is `local_file`."
            ),
            "type": "string",
        },
    },
}
INPUT_FILE_LIST_SCHEMA: dict[str, object] = {
    "anyOf": [{"items": INPUT_FILE_ITEM_SCHEMA, "type": "array"}, {"type": "null"}]
}
InputFileList = Annotated[list[dict[str, Any]] | None, WithJsonSchema(INPUT_FILE_LIST_SCHEMA)]


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


def multipart_file_params(*, include_user: bool, file_description: str | None = None) -> dict[str, dict[str, object]]:
    file_param = deepcopy(FILE_FORM_PARAM)
    if file_description is not None:
        file_param["description"] = file_description

    params: dict[str, dict[str, object]] = {"file": file_param}
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
