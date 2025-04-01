from enum import StrEnum


class ResponseFormat(StrEnum):
    """Constants for model response formats"""

    JSON_SCHEMA = "json_schema"
    JSON = "JSON"
    JSON_OBJECT = "json_object"


class SpecialModelType(StrEnum):
    """Constants for identifying model types"""

    GEMINI = "gemini"
    OLLAMA = "ollama"
