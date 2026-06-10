from core.tools.entities.tool_entities import ToolInvokeMeta
from libs.exception import BaseHTTPException


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


class ToolSSRFError(ValueError):
    pass


class ToolCredentialPolicyViolationError(ValueError):
    pass


class ApiToolProviderNotFoundError(ValueError):
    error_code = "api_tool_provider_not_found"
    provider_name: str
    tenant_id: str

    def __init__(self, provider_name: str, tenant_id: str):
        self.provider_name = provider_name
        self.tenant_id = tenant_id
        super().__init__(f"api provider {provider_name} does not exist")


class WorkflowToolHumanInputNotSupportedError(BaseHTTPException):
    error_code = "workflow_tool_human_input_not_supported"
    description = "Workflow with Human Input nodes cannot be published as a workflow tool."
    code = 400


class ToolEngineInvokeError(Exception):
    meta: ToolInvokeMeta

    def __init__(self, meta, **kwargs):
        self.meta = meta
        super().__init__(**kwargs)
