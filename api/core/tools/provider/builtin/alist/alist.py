from typing import Any

import httpx

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AListProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            if "alist_base_url" not in credentials or not credentials.get("alist_base_url"):
                raise ToolProviderCredentialValidationError("AList base url is required.")

            alist_base_url = credentials.get("alist_base_url")

            try:
                response = httpx.get(url=f"{alist_base_url}/ping")
                response.raise_for_status()
                if response.text != "pong":
                    raise ToolProviderCredentialValidationError("Alist base url is invalid.")
            except Exception as e:
                raise ToolProviderCredentialValidationError("Alist base url is invalid. {}".format(e))
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
