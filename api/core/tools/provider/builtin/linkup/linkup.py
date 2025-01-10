from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from linkup import LinkupClient

class LinkupProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            if "api_key" not in credentials or not credentials.get("api_key"):
                raise ToolProviderCredentialValidationError("Linkup API key is required.")

            api_key = credentials.get("api_key")
            client = LinkupClient(api_key=api_key)
            try:
                response = client.search(query="test")
                if not response or response.get("error"):
                    raise ToolProviderCredentialValidationError("Invalid Linkup API key.")
            except Exception as e:
                raise ToolProviderCredentialValidationError(f"Linkup API key validation failed: {str(e)}")

        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
