from core.tools.entities.tool_entities import ToolInvokeMeta


class ToolProviderNotFoundError(ValueError):
    pass


class ToolNotFoundError(ValueError):
    pass


class ToolParameterValidationError(ValueError):
    pass


class ToolProviderCredentialValidationError(ValueError):
    pass


class ToolNotSupportedError(ValueError):
    pass


class ToolInvokeError(ValueError):
    pass


class ToolApiSchemaError(ValueError):
    pass


class ToolEngineInvokeError(Exception):
    meta: ToolInvokeMeta

    def __init__(self, meta, **kwargs):
        self.meta = meta
        super().__init__(**kwargs)
