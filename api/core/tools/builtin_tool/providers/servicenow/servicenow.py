from typing import Any

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolInvokeError, ToolProviderCredentialValidationError

from ._client import ServiceNowClient


class ServiceNowToolProvider(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        try:
            client = ServiceNowClient(credentials)
            client.validate_connection()
        except ToolInvokeError as exc:
            raise ToolProviderCredentialValidationError(str(exc)) from exc
