"""String choices with the existing Builder JSON validation contract."""

from enum import StrEnum
from typing import Self

from pydantic import GetCoreSchemaHandler
from pydantic_core import CoreSchema, core_schema


class BuilderStringEnum(StrEnum):
    """Keep Builder DTO choices as strings on the wire and enums in Python."""

    @classmethod
    def __get_pydantic_core_schema__(
        cls: type[Self], _source_type: type[Self], _handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        """Validate the exact string choices, including in strict Python mode.

        Keep the inline JSON Schema values and serialize to plain strings in
        both dump modes so persisted payloads and existing clients are compatible.
        """
        choices = core_schema.literal_schema([member.value for member in cls])
        return core_schema.no_info_after_validator_function(
            cls,
            choices,
            serialization=core_schema.plain_serializer_function_ser_schema(str, return_schema=choices),
        )
