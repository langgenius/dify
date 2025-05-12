from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.utils.web_reader_tool import get_url


class WebscraperTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke tools
        """
        try:
            url = tool_parameters.get("url", "")
            user_agent = tool_parameters.get("user_agent", "")
            if not url:
                yield self.create_text_message("Please input url")
                return

            # get webpage
            result = get_url(url, user_agent=user_agent)

            if tool_parameters.get("generate_summary"):
                # summarize and return
                yield self.create_text_message(self.summary(user_id=user_id, content=result))
            else:
                # return full webpage
                yield self.create_text_message(result)
        except Exception as e:
            raise ToolInvokeError(str(e))
