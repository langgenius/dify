from enum import StrEnum


class CommonParameterType(StrEnum):
    SECRET_INPUT = "secret-input"
    TEXT_INPUT = "text-input"
    SELECT = "select"
    STRING = "string"
    NUMBER = "number"
    FILE = "file"
    FILES = "files"
    SYSTEM_FILES = "system-files"
    BOOLEAN = "boolean"
    APP_SELECTOR = "app-selector"
    MODEL_SELECTOR = "model-selector"
    TOOLS_SELECTOR = "array[tools]"
    ANY = "any"

    # Dynamic select parameter
    # Once you are not sure about the available options until authorization is done
    # eg: Select a Slack channel from a Slack workspace
    DYNAMIC_SELECT = "dynamic-select"

    # TOOL_SELECTOR = "tool-selector"
    # MCP object and array type parameters
    ARRAY = "array"
    OBJECT = "object"


class AppSelectorScope(StrEnum):
    ALL = "all"
    CHAT = "chat"
    WORKFLOW = "workflow"
    COMPLETION = "completion"


class ModelSelectorScope(StrEnum):
    LLM = "llm"
    TEXT_EMBEDDING = "text-embedding"
    RERANK = "rerank"
    TTS = "tts"
    SPEECH2TEXT = "speech2text"
    MODERATION = "moderation"
    VISION = "vision"


class ToolSelectorScope(StrEnum):
    ALL = "all"
    CUSTOM = "custom"
    BUILTIN = "builtin"
    WORKFLOW = "workflow"
