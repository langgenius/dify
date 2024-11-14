from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AudioToolProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        pass
