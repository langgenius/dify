from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.utils.feishu_api_utils import auth


class FeishuTaskProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        auth(credentials)
