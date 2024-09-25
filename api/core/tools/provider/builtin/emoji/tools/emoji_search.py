from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.emoji._emoji_tool_base import EmojiToolBase
from typing import Any, Union


class EmojiSearchTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        query = tool_parameters.get("query")
        emoSearch = EmojiToolBase(
            emo_vector_path=tool_parameters.get("emo_vector_path", "/home/cipher/code/dify/cache/emo/vector"),
            embedding_model_path=tool_parameters.get("embedding_model_path", "/home/data/cipher/model/Xorbits/bge-m3"),
            emo_data_path=tool_parameters.get("emo_data_path", "/home/data/cipher/data/emo"),
        )
        result = emoSearch._search_emoji(query)

        if result:
            # return self.create_text_message(text=result)
            return self.create_link_message(result)
