"""Compatibility helpers for Dify's Flask-RESTX OpenAPI integration.

These helpers are temporary bridges for legacy Flask-RESTX field contracts
while controllers migrate their request and response documentation to Pydantic
models. Keep the behavior centralized so live OpenAPI endpoints and offline
spec export fail or succeed in the same way.
"""

import hashlib
import json
from collections.abc import Mapping
from typing import TypeGuard, cast

from flask import current_app
from flask_restx import fields
from flask_restx import swagger as restx_swagger
from flask_restx.model import Model, ModelBase, OrderedModel, instance
from flask_restx.swagger import Swagger
from flask_restx.utils import not_none

BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY = "dify-binary-response-media-types"
_BINARY_RESPONSE_MEDIA_TYPES_EXTENSION = f"x-{BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY}"
_HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}


def _normalize_media_type(media_type: str) -> str:
    """Return the case-insensitive media type without optional parameters."""

    return media_type.partition(";")[0].strip().lower()


def _add_transport_response_schemas(payload: dict[str, object]) -> None:
    """Finalize response schemas that Flask-RESTX cannot express directly."""

    paths = payload.get("paths")
    if not isinstance(paths, dict):
        return

    for path_item in paths.values():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in _HTTP_METHODS or not isinstance(operation, dict):
                continue

            binary_media_types = operation.pop(_BINARY_RESPONSE_MEDIA_TYPES_EXTENSION, [])
            normalized_binary_media_types = {
                _normalize_media_type(media_type) for media_type in binary_media_types if isinstance(media_type, str)
            }

            responses = operation.get("responses")
            if not isinstance(responses, dict):
                continue
            for response in responses.values():
                if not isinstance(response, dict):
                    continue
                content = response.get("content")
                if not isinstance(content, dict):
                    continue
                for media_type, media in content.items():
                    if not isinstance(media_type, str) or not isinstance(media, dict):
                        continue
                    normalized_media_type = _normalize_media_type(media_type)
                    if normalized_media_type == "text/event-stream":
                        # Flask-RESTX attaches the status response model to every
                        # produced media type. The model describes the blocking
                        # JSON body; the SSE transport itself is always text.
                        media["schema"] = {"type": "string"}
                    elif normalized_media_type in normalized_binary_media_types:
                        # Binary responses are explicitly marked by the
                        # service_api.schema.binary_response decorator. Do not
                        # guess from an unfamiliar non-JSON media type.
                        media["schema"] = {"format": "binary", "type": "string"}


def _deduplicate_operation_ids(payload: dict[str, object]) -> None:
    """Make operationId values unique while preserving the canonical route ID."""

    paths = payload.get("paths")
    if not isinstance(paths, dict):
        return

    operations_by_id: dict[str, list[tuple[str, str, dict[str, object]]]] = {}
    for path, path_item in paths.items():
        if not isinstance(path, str) or not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in _HTTP_METHODS or not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if isinstance(operation_id, str):
                operations_by_id.setdefault(operation_id, []).append((method, path, operation))

    for operation_id, operations in operations_by_id.items():
        if len(operations) < 2:
            continue
        ordered_operations = sorted(
            operations,
            key=lambda item: (
                bool(item[2].get("deprecated")),
                "_" in item[1],
                item[1],
                item[0],
            ),
        )
        for index, (method, path, operation) in enumerate(ordered_operations):
            if index == 0:
                continue
            digest = hashlib.sha1(f"{method}:{path}".encode()).hexdigest()[:8]
            operation["operationId"] = f"{operation_id}_{digest}"


def sort_openapi_arrays(value: object, *, parent_key: str | None = None) -> object:
    """Sort order-insensitive OpenAPI arrays so every public representation is stable."""

    if isinstance(value, dict):
        return {key: sort_openapi_arrays(item, parent_key=key) for key, item in value.items()}
    if not isinstance(value, list):
        return value

    sorted_items = [sort_openapi_arrays(item, parent_key=parent_key) for item in value]
    if parent_key == "parameters":
        return sorted(
            sorted_items,
            key=lambda item: (
                item.get("in", "") if isinstance(item, dict) else "",
                item.get("name", "") if isinstance(item, dict) else "",
                json.dumps(item, sort_keys=True, default=str),
            ),
        )
    if parent_key in {"enum", "required", "schemes", "tags"}:
        string_items = [item for item in sorted_items if isinstance(item, str)]
        if len(string_items) == len(sorted_items):
            return sorted(string_items)
    return sorted_items


def _replace_legacy_refs(value: object) -> object:
    if isinstance(value, dict):
        replaced: dict[object, object] = {}
        for key, item in value.items():
            if key == "$ref" and isinstance(item, str) and item.startswith("#/definitions/"):
                replaced[key] = item.replace("#/definitions/", "#/components/schemas/", 1)
            else:
                replaced[key] = _replace_legacy_refs(item)
        return replaced
    if isinstance(value, list):
        return [_replace_legacy_refs(item) for item in value]
    return value


def _merge_registered_schemas(payload: dict[str, object], registered_models: Mapping[str, object]) -> dict[str, object]:
    """Include registered but route-indirect models in every public OpenAPI representation."""

    components = payload.setdefault("components", {})
    if not isinstance(components, dict):
        raise RuntimeError("unexpected OpenAPI components payload")
    schemas = components.setdefault("schemas", {})
    if not isinstance(schemas, dict):
        raise RuntimeError("unexpected OpenAPI component schemas payload")

    for name, model in registered_models.items():
        if isinstance(model, ModelBase):
            schemas.setdefault(name, _replace_legacy_refs(model.__schema__))

    payload.pop("definitions", None)
    replaced_payload = _replace_legacy_refs(payload)
    if not isinstance(replaced_payload, dict):
        raise RuntimeError("unexpected OpenAPI payload")
    return cast(dict[str, object], replaced_payload)


def finalize_openapi_payload(
    payload: dict[str, object], *, registered_models: Mapping[str, object] | None = None
) -> dict[str, object]:
    """Apply the shared finalization used by live and exported OpenAPI specs."""

    if registered_models is not None:
        payload = _merge_registered_schemas(payload, registered_models)
    _add_transport_response_schemas(payload)
    _deduplicate_operation_ids(payload)
    return cast(dict[str, object], sort_openapi_arrays(payload))


def _is_inline_field_map(value: object) -> TypeGuard[dict[object, object]]:
    """Return whether a nested field map is an anonymous inline mapping."""

    return isinstance(value, dict) and not isinstance(value, (Model, OrderedModel))


def _jsonable_schema_value(value: object) -> object:
    """Return a deterministic JSON-serializable representation for schema fingerprints."""

    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, list | tuple):
        return [_jsonable_schema_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable_schema_value(item) for key, item in value.items()}
    value_type = type(value)
    return f"<{value_type.__module__}.{value_type.__qualname__}>"


def _field_signature(field: object) -> object:
    """Build a stable signature for a Flask-RESTX field object."""

    field_instance = instance(field)
    signature: dict[str, object] = {
        "class": f"{field_instance.__class__.__module__}.{field_instance.__class__.__qualname__}"
    }

    if isinstance(field_instance, fields.Nested):
        nested = getattr(field_instance, "nested", None)
        if _is_inline_field_map(nested):
            signature["nested"] = _inline_model_signature(nested)
        else:
            signature["nested"] = getattr(
                nested,
                "name",
                f"<{type(nested).__module__}.{type(nested).__qualname__}>",
            )
    elif hasattr(field_instance, "container"):
        signature["container"] = _field_signature(field_instance.container)
    else:
        schema = getattr(field_instance, "__schema__", None)
        if isinstance(schema, dict):
            signature["schema"] = _jsonable_schema_value(schema)

    for attr_name in (
        "attribute",
        "default",
        "description",
        "example",
        "max",
        "max_items",
        "min",
        "min_items",
        "nullable",
        "readonly",
        "required",
        "title",
        "unique",
    ):
        if hasattr(field_instance, attr_name):
            signature[attr_name] = _jsonable_schema_value(getattr(field_instance, attr_name))

    return signature


def _inline_model_signature(nested_fields: dict[object, object]) -> object:
    """Build a stable signature for an anonymous inline model."""

    return [
        (str(field_name), _field_signature(field))
        for field_name, field in sorted(nested_fields.items(), key=lambda item: str(item[0]))
    ]


def _inline_model_name(nested_fields: dict[object, object]) -> str:
    """Return a stable OpenAPI model name for an anonymous inline field map."""

    signature = json.dumps(_inline_model_signature(nested_fields), sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha1(signature.encode("utf-8")).hexdigest()[:12]
    return f"_AnonymousInlineModel_{digest}"


def install_swagger_compatibility() -> None:
    """Install Dify's Flask-RESTX OpenAPI compatibility hooks.

    Some existing controllers use raw field mappings in `fields.Nested({...})`
    or directly in `@namespace.response(...)`. Runtime marshalling accepts that,
    but Flask-RESTX registration expects a named model. Convert those
    anonymous mappings into temporary named models during docs generation.

    Flask-RESTX also drops parameter descriptions from generated schemas and
    does not expose the Werkzeug `uuid` route converter as `format: uuid`.
    """

    if getattr(Swagger, "_dify_swagger_compatibility_installed", False):
        return

    original_register_model = Swagger.register_model
    original_register_field = Swagger.register_field
    original_extract_path_params = restx_swagger.extract_path_params
    original_schema_from_parameter = Swagger.schema_from_parameter
    original_description_for = Swagger.description_for
    original_serialize_operation = Swagger.serialize_operation
    original_responses_for = Swagger.responses_for
    original_parameters_and_request_body_for = Swagger.parameters_and_request_body_for
    original_request_body_from_form_params = Swagger.request_body_from_form_params
    original_as_dict = Swagger.as_dict

    def get_or_create_inline_model(self: Swagger, nested_fields: dict[object, object]) -> object:
        anonymous_name = _inline_model_name(nested_fields)
        if anonymous_name not in self.api.models:
            self.api.model(anonymous_name, nested_fields)

        return self.api.models[anonymous_name]

    def register_model_with_inline_dict_support(self: Swagger, model: object) -> dict[str, str]:
        if _is_inline_field_map(model):
            model = get_or_create_inline_model(self, model)

        return original_register_model(self, model)

    def register_field_with_inline_dict_support(self: Swagger, field: object) -> None:
        nested = getattr(field, "nested", None)
        if _is_inline_field_map(nested):
            field.model = get_or_create_inline_model(self, nested)  # type: ignore[attr-defined]

        original_register_field(self, field)

    def schema_from_parameter_with_description(self: Swagger, param: dict[str, object]) -> dict[str, object]:
        schema = cast(dict[str, object], original_schema_from_parameter(self, param))
        description = param.get("description")
        if isinstance(description, str):
            schema["description"] = description
        return schema

    def extract_path_params_with_uuid_format(path: str):
        params = original_extract_path_params(path)
        for converter, _arguments, variable in restx_swagger.parse_rule(path):
            if converter == "uuid" and variable in params:
                params[variable]["format"] = "uuid"
        return params

    def description_for_with_explicit_summary(self: Swagger, doc: dict[str, object], method: str):
        method_doc = doc.get(method)
        if (
            isinstance(method_doc, dict)
            and isinstance(method_doc.get("summary"), str)
            and isinstance(method_doc.get("description"), str)
        ):
            return method_doc["description"]
        return original_description_for(self, doc, method)

    def serialize_operation_with_explicit_summary_tags(
        self: Swagger, doc: dict[str, object], method: str, inherited_request_body=None
    ):
        operation = original_serialize_operation(self, doc, method, inherited_request_body)
        method_doc = doc.get(method)
        if not isinstance(method_doc, dict):
            return operation

        summary = method_doc.get("summary")
        if isinstance(summary, str):
            operation["summary"] = summary

        tags = method_doc.get("tags")
        if isinstance(tags, list) and all(isinstance(tag, str) for tag in tags):
            operation["tags"] = tags

        return operation

    def responses_for_with_status_specific_media(self: Swagger, doc: dict[str, object], method: str):
        responses = original_responses_for(self, doc, method)
        blueprint = self.api.blueprint
        if blueprint is None or blueprint.name != "service_api":
            return responses
        method_doc = doc.get(method)
        if not isinstance(method_doc, dict):
            return responses

        for status, response in responses.items():
            if not isinstance(response, dict) or str(status).startswith("2"):
                continue
            content = response.get("content")
            if not isinstance(content, dict) or not content:
                response["content"] = {"application/json": {}}
                continue
            schemas = [media for media in content.values() if isinstance(media, dict) and "schema" in media]
            if schemas:
                response["content"] = {"application/json": schemas[0]}
            else:
                response["content"] = {"application/json": {}}
        return responses

    def serialize_resource_with_explicit_operation_tags(self: Swagger, ns, resource, url, route_doc=None, **kwargs):
        doc = self.extract_resource_doc(resource, url, route_doc=route_doc)
        if doc is False:
            return None

        path_params, path_request_body = original_parameters_and_request_body_for(self, doc)
        path: dict[str, object] = {"parameters": path_params or None}
        methods = [method.lower() for method in resource.methods or []]
        requested_methods = [method.lower() for method in kwargs.get("methods", [])]
        for method in methods:
            if doc[method] is False or requested_methods and method not in requested_methods:
                continue
            operation = self.serialize_operation(doc, method, path_request_body)
            operation.setdefault("tags", [ns.name])
            path[method] = operation
        return not_none(path)

    def request_body_from_form_params_with_file_description(self: Swagger, params: list[dict[str, object]]):
        request_body = original_request_body_from_form_params(self, params)
        for param in params:
            if param.get("type") != "file":
                continue

            name = param.get("name")
            description = param.get("description")
            if not isinstance(name, str) or not isinstance(description, str):
                continue

            content = request_body.get("content")
            if not isinstance(content, dict):
                continue
            multipart = content.get("multipart/form-data")
            if not isinstance(multipart, dict):
                continue
            schema = multipart.get("schema")
            if not isinstance(schema, dict):
                continue
            properties = schema.get("properties")
            if not isinstance(properties, dict):
                continue
            file_schema = properties.get(name)
            if isinstance(file_schema, dict):
                file_schema["description"] = description

        return request_body

    def as_dict_with_inline_dict_support(self: Swagger):
        # Temporary set RESTX_INCLUDE_ALL_MODELS = false to prevent "length changed while iterating" error
        include_all_models = current_app.config.get("RESTX_INCLUDE_ALL_MODELS", False)
        current_app.config["RESTX_INCLUDE_ALL_MODELS"] = False
        try:
            payload = original_as_dict(self)
            return finalize_openapi_payload(payload, registered_models=self.api.models)
        finally:
            current_app.config["RESTX_INCLUDE_ALL_MODELS"] = include_all_models

    Swagger.register_model = register_model_with_inline_dict_support
    Swagger.register_field = register_field_with_inline_dict_support
    restx_swagger.extract_path_params = extract_path_params_with_uuid_format
    Swagger.schema_from_parameter = schema_from_parameter_with_description
    Swagger.description_for = description_for_with_explicit_summary
    Swagger.serialize_operation = serialize_operation_with_explicit_summary_tags
    Swagger.responses_for = responses_for_with_status_specific_media
    Swagger.serialize_resource = serialize_resource_with_explicit_operation_tags
    Swagger.request_body_from_form_params = request_body_from_form_params_with_file_description
    Swagger.as_dict = as_dict_with_inline_dict_support
    Swagger._dify_swagger_compatibility_installed = True
