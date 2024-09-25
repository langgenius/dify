from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool.tool import Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.emoji.tools.emoji_search import EmojiSearchTool

from typing import Any


class EmojiProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            EmojiSearchTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "emo_vector_path": "/home/cipher/code/dify/cache/emo/vector",
                    "embedding_model_path": "/home/data/cipher/model/Xorbits/bge-m3",
                    "emo_data_path": "/home/data/cipher/data/emo",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
