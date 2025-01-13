from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.utils.lark_api_utils import lark_auth


class LarkMessageProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        lark_auth(credentials)
