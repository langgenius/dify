from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.utils.jotterpad_api_utils import jotterpad_auth


class JotterPadProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        jotterpad_auth(credentials)
