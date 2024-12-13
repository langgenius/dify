from enum import Enum


class CommonParameterType(Enum):
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
    # TOOL_SELECTOR = "tool-selector"
    MODEL_SELECTOR = "model-selector"
    TOOLS_SELECTOR = "array[tools]"


class AppSelectorScope(Enum):
    ALL = "all"
    CHAT = "chat"
    WORKFLOW = "workflow"
    COMPLETION = "completion"


class ModelSelectorScope(Enum):
    LLM = "llm"
    TEXT_EMBEDDING = "text-embedding"
    RERANK = "rerank"
    TTS = "tts"
    SPEECH2TEXT = "speech2text"
    MODERATION = "moderation"
    VISION = "vision"


class ToolSelectorScope(Enum):
    ALL = "all"
    CUSTOM = "custom"
    BUILTIN = "builtin"
    WORKFLOW = "workflow"
