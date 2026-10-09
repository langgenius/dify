"""``UploadPart``: a file part as a Pydantic type, so request models stay the single
source of truth for files too. Validates to a werkzeug ``FileStorage`` at runtime and
renders as ``{"type": "string", "format": "binary"}`` in JSON Schema (the OpenAPI file
convention the CLI's bind derivation keys on).

``file_fields`` reads that convention back off a model: the body fields a multipart
request may carry file parts for. The catalog's ``bind`` and the request parser agree
by construction because both ask this one question. ``describe_multipart_bodies`` asks
it of the exported OpenAPI document, so the contract advertises the multipart form
``_multipart.py`` accepts.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Any, Final

from pydantic import BaseModel, GetCoreSchemaHandler, GetJsonSchemaHandler
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema
from werkzeug.datastructures import FileStorage


class _UploadPartType:
    @classmethod
    def __get_pydantic_core_schema__(cls, source: Any, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.is_instance_schema(FileStorage)

    @classmethod
    def __get_pydantic_json_schema__(
        cls, schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        return {"type": "string", "format": "binary"}


UploadPart = Annotated[FileStorage, _UploadPartType()]
UploadParts = dict[str, UploadPart | list[UploadPart]]


def has_binary_leaf(node: Any) -> bool:
    if isinstance(node, list):
        return any(has_binary_leaf(item) for item in node)
    if not isinstance(node, Mapping):
        return False
    if node.get("type") == "string" and node.get("format") == "binary":
        return True
    return any(has_binary_leaf(value) for value in node.values())


def file_fields(model: type[BaseModel]) -> frozenset[str]:
    schema = model.model_json_schema()
    return frozenset(name for name, prop in schema.get("properties", {}).items() if has_binary_leaf(prop))


_JSON_MEDIA: Final = "application/json"
_MULTIPART_MEDIA: Final = "multipart/form-data"


def _schemas_of(document: Mapping[str, Any]) -> Mapping[str, Any]:
    return document.get("definitions") or document.get("components", {}).get("schemas", {})


def describe_multipart_bodies(document: dict[str, Any]) -> dict[str, Any]:
    """Add ``multipart/form-data`` to every request body whose schema carries file fields.

    Flask-RESTX documents a Pydantic body as JSON only. On this surface a body with
    ``UploadPart`` fields is also accepted as multipart: file fields as file parts, every
    other field as JSON text under its own part name. A body of nothing but files is
    multipart only, since JSON cannot carry it at all.
    """
    schemas = _schemas_of(document)
    for item in document.get("paths", {}).values():
        for operation in item.values():
            if not isinstance(operation, Mapping):
                continue
            content: dict[str, Any] = operation.get("requestBody", {}).get("content", {})
            json_media = content.get(_JSON_MEDIA)
            if not json_media:
                continue
            schema = schemas.get(json_media.get("schema", {}).get("$ref", "").rsplit("/", 1)[-1], {})
            properties = schema.get("properties", {})
            files = {name for name, prop in properties.items() if has_binary_leaf(prop)}
            if not files:
                continue
            multipart: dict[str, Any] = {"schema": dict(json_media["schema"])}
            encoding = {name: {"contentType": _JSON_MEDIA} for name in properties if name not in files}
            if encoding:
                multipart["encoding"] = encoding
            else:
                del content[_JSON_MEDIA]
            content[_MULTIPART_MEDIA] = multipart
    return document


__all__ = ["UploadPart", "UploadParts", "describe_multipart_bodies", "file_fields", "has_binary_leaf"]
