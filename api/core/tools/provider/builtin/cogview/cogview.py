"""Provide the input parameters type for the cogview provider class"""

from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.cogview.tools.cogview3 import CogView3Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class COGVIEWProvider(BuiltinToolProviderController):
    """cogview provider"""

    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            CogView3Tool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "prompt": "一个城市在水晶瓶中欢快生活的场景，水彩画风格，展现出微观与珠宝般的美丽。",
                    "size": "square",
                    "n": 1,
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e)) from e
