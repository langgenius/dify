from enum import StrEnum


class ResponseFormat(StrEnum):
    """Constants for model response formats"""

    JSON_SCHEMA = "json_schema"  # model's structured output mode. some model like gemini, gpt-4o,  support this mode.
    JSON = "JSON"  # model's json mode. some model like claude support this mode.
    JSON_OBJECT = "json_object"  # json mode's another alias. some model like deepseek-chat, qwen use this alias.


class SpecialModelType(StrEnum):
    """Constants for identifying model types"""

    GEMINI = "gemini"
    OLLAMA = "ollama"


class SupportStructuredOutputStatus(StrEnum):
    """Constants for structured output support status"""

    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    DISABLED = "disabled"
