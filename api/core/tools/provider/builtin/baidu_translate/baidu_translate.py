from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.baidu_translate.tools.translate import BaiduTranslateTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class BaiduTranslateProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            BaiduTranslateTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(user_id="", tool_parameters={"q": "这是一段测试文本", "from": "auto", "to": "en"})
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
