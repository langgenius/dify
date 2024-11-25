from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class StackExchangeProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        print("tool init")
