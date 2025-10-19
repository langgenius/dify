from enum import StrEnum, auto


class CommonParameterType(StrEnum):
    SECRET_INPUT = "secret-input"
    TEXT_INPUT = "text-input"
    SELECT = auto()
    STRING = auto()
    NUMBER = auto()
    FILE = auto()
    FILES = auto()
    SYSTEM_FILES = "system-files"
    BOOLEAN = auto()
    APP_SELECTOR = "app-selector"
    MODEL_SELECTOR = "model-selector"
    TOOLS_SELECTOR = "array[tools]"
    ANY = auto()

    # Dynamic select parameter
    # Once you are not sure about the available options until authorization is done
    # eg: Select a Slack channel from a Slack workspace
    DYNAMIC_SELECT = "dynamic-select"

    # TOOL_SELECTOR = "tool-selector"
    # MCP object and array type parameters
    ARRAY = auto()
    OBJECT = auto()


class AppSelectorScope(StrEnum):
    ALL = auto()
    CHAT = auto()
    WORKFLOW = auto()
    COMPLETION = auto()


class ModelSelectorScope(StrEnum):
    LLM = auto()
    TEXT_EMBEDDING = "text-embedding"
    RERANK = auto()
    TTS = auto()
    SPEECH2TEXT = auto()
    MODERATION = auto()
    VISION = auto()


class ToolSelectorScope(StrEnum):
    ALL = auto()
    CUSTOM = auto()
    BUILTIN = auto()
    WORKFLOW = auto()
