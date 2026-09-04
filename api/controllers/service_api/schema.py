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

from libs.flask_restx_compat import BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY

USER_DESCRIPTION = (
    "User identifier, unique within the application. This identifier scopes data access; resources created with "
    "one `user` value are only visible when queried with the same `user` value."
)
SCOPED_TASK_STOP_USER_DESCRIPTION = (
    "End-user identifier, defined by your app and unique within it. Send the same `user` value used for the original "
    "generation request. See "
    "[End User Identity](/api-reference/guides/end-user-identity)."
)
WORKFLOW_TASK_STOP_USER_DESCRIPTION = (
    "End-user identifier, defined by your app and unique within it. It does not need to match the `user` that "
    "started the run; the stop applies to the task regardless of `user`. See "
    "[End User Identity](/api-reference/guides/end-user-identity)."
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


def _input_file_variant(transfer_method: str, source: str) -> dict[str, object]:
    return {
        "type": "object",
        "properties": {
            "type": {
                "description": "File type.",
                "enum": ["document", "image", "audio", "video", "custom"],
                "type": "string",
            },
            "transfer_method": {
                "description": (
                    "Transfer method: `remote_url` for a file URL or persisted uploaded-file reference, "
                    "`local_file` for an uploaded file."
                ),
                "enum": [transfer_method],
                "type": "string",
            },
            "url": {
                "description": "File URL when `transfer_method` is `remote_url`.",
                "format": "url",
                "type": "string",
            },
            "remote_url": {
                "description": "Legacy alias of `url` when `transfer_method` is `remote_url`.",
                "format": "url",
                "type": "string",
            },
            "upload_file_id": {
                "description": (
                    "Uploaded file ID obtained from the [Upload File](/api-reference/files/upload-file) API. "
                    "Required for `local_file`; also accepted with `remote_url` for compatibility with persisted "
                    "file references."
                ),
                "type": "string",
            },
        },
        "required": ["type", "transfer_method", source],
    }


INPUT_FILE_ITEM_SCHEMA: dict[str, object] = {
    "type": "object",
    "anyOf": [
        _input_file_variant("remote_url", "url"),
        _input_file_variant("remote_url", "remote_url"),
        _input_file_variant("remote_url", "upload_file_id"),
        _input_file_variant("local_file", "upload_file_id"),
    ],
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


def expect_user_json(
    namespace: Namespace,
    *,
    model_name: str | None = None,
    user_description: str = USER_DESCRIPTION,
):
    """Document a JSON request body that only carries the Service API ``user``."""

    def decorator(view_func):
        required = _json_user_required(view_func)
        schema: dict[str, object] = {"properties": {}, "title": "ServiceApiUserPayload", "type": "object"}
        _add_user_property(schema, required=required, description=user_description)
        resolved_model_name = model_name or (
            "RequiredServiceApiUserPayload" if required else "OptionalServiceApiUserPayload"
        )
        if resolved_model_name not in namespace.models:
            namespace.schema_model(resolved_model_name, schema)
        return namespace.expect(namespace.models[resolved_model_name], validate=False)(view_func)

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
    return namespace.doc(
        produces=media_types,
        vendor={BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY: media_types},
    )


def _json_user_required(view_func) -> bool:
    fetch_from = getattr(view_func, USER_FETCH_FROM_ATTR, None)
    if fetch_from != JSON_USER_FETCH_FROM:
        raise ValueError("JSON user documentation must match validate_app_token(fetch_user_arg=WhereisUserArg.JSON)")

    return bool(getattr(view_func, USER_REQUIRED_ATTR, False))


def _add_user_property(schema: dict[str, object], *, required: bool, description: str = USER_DESCRIPTION) -> None:
    variants: list[dict[str, object]] = []
    for keyword in ("anyOf", "oneOf"):
        candidates = schema.get(keyword)
        if isinstance(candidates, list):
            variants.extend(candidate for candidate in candidates if isinstance(candidate, dict))

    if variants:
        for variant in variants:
            _add_user_property_to_object_schema(variant, required=required, description=description)

    _add_user_property_to_object_schema(schema, required=required, description=description)


def _add_user_property_to_object_schema(schema: dict[str, object], *, required: bool, description: str) -> None:
    properties = schema.setdefault("properties", {})
    if isinstance(properties, dict):
        cast(dict[str, object], properties)["user"] = {"description": description, "type": "string"}

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
