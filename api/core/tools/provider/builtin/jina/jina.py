import json
from typing import Any

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.jina.tools.jina_reader import JinaReaderTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GoogleProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            if credentials['api_key'] is None:
                credentials['api_key'] = ''
            else:
                result = JinaReaderTool().fork_tool_runtime(
                    runtime={
                        "credentials": credentials,
                    }
                ).invoke(
                    user_id='',
                    tool_parameters={
                        "url": "https://example.com",
                    },
                )[0]

                message = json.loads(result.message)
                if message['code'] != 200:
                    raise ToolProviderCredentialValidationError(message['message'])
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.SEARCH, ToolLabelEnum.PRODUCTIVITY
        ]