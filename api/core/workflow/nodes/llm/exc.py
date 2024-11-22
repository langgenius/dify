class LLMNodeError(ValueError):
    """Base class for LLM Node errors."""


class VariableNotFoundError(LLMNodeError):
    """Raised when a required variable is not found."""


class InvalidContextStructureError(LLMNodeError):
    """Raised when the context structure is invalid."""


class InvalidVariableTypeError(LLMNodeError):
    """Raised when the variable type is invalid."""


class ModelNotExistError(LLMNodeError):
    """Raised when the specified model does not exist."""


class LLMModeRequiredError(LLMNodeError):
    """Raised when LLM mode is required but not provided."""


class NoPromptFoundError(LLMNodeError):
    """Raised when no prompt is found in the LLM configuration."""


class TemplateTypeNotSupportError(LLMNodeError):
    def __init__(self, *, type_name: str):
        super().__init__(f"Prompt type {type_name} is not supported.")


class MemoryRolePrefixRequiredError(LLMNodeError):
    """Raised when memory role prefix is required for completion model."""


class FileTypeNotSupportError(LLMNodeError):
    def __init__(self, *, type_name: str):
        super().__init__(f"{type_name} type is not supported by this model")
