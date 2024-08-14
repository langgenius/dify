from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.google_translate.tools.translate import GoogleTranslate
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class JsonExtractProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            GoogleTranslate().invoke(user_id='',
                                     tool_parameters={
                                         "content": "这是一段测试文本",
                                         "dest": "en"
                                     })
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
