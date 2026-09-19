"""``UploadPart``: a file part as a Pydantic type, so request models stay the single
source of truth for files too. Validates to a werkzeug ``FileStorage`` at runtime and
renders as ``{"type": "string", "format": "binary"}`` in JSON Schema (the OpenAPI file
convention the CLI's bind derivation keys on).

``file_fields`` reads that convention back off a model: the body fields a multipart
request may carry file parts for. The catalog's ``bind`` and the request parser agree
by construction because both ask this one question.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Any

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


__all__ = ["UploadPart", "UploadParts", "file_fields", "has_binary_leaf"]
