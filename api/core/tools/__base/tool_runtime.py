from typing import Any

from pydantic import BaseModel, Field

from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.tool_entities import ToolInvokeFrom


class ToolRuntime(BaseModel):
    """
    Meta data of a tool call processing.

    ``user_id`` is optional so read-only tooling flows can stay tenant-scoped,
    while execution paths may bind caller identity for model runtime lookups.
    """

    tenant_id: str
    user_id: str | None = None
    tool_id: str | None = None
    invoke_from: InvokeFrom | None = None
    tool_invoke_from: ToolInvokeFrom | None = None
    credentials: dict[str, Any] = Field(default_factory=dict)
    credential_type: CredentialType = Field(default=CredentialType.API_KEY)
    runtime_parameters: dict[str, Any] = Field(default_factory=dict)


class FakeToolRuntime(ToolRuntime):
    """
    Fake tool runtime for testing
    """

    def __init__(self):
        super().__init__(
            tenant_id="fake_tenant_id",
            tool_id="fake_tool_id",
            invoke_from=InvokeFrom.DEBUGGER,
            tool_invoke_from=ToolInvokeFrom.AGENT,
            credentials={},
            runtime_parameters={},
        )
