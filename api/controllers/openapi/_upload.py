"""``UploadPart``: a file part as a Pydantic type, so request models stay the single
source of truth for files too. Validates to a werkzeug ``FileStorage`` at runtime and
renders as ``{"type": "string", "format": "binary"}`` in JSON Schema (the OpenAPI file
convention the CLI's bind derivation keys on).
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler
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

__all__ = ["UploadPart", "UploadParts"]
