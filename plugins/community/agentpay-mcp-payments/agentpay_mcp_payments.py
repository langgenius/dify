# pyright: reportMissingImports=false

from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.client import AgentPayMCPClient, AgentPayMCPError


class AgentPayMCPPaymentsProvider(ToolProvider):
    """Credential validation and provider-level lifecycle for AgentPay MCP tools."""

    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            client = AgentPayMCPClient.from_credentials(credentials)
            client.call_tool("check_balance", {})
        except AgentPayMCPError as exc:
            raise ToolProviderCredentialValidationError(str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise ToolProviderCredentialValidationError(
                f"Failed to validate AgentPay credentials: {exc}"
            ) from exc
