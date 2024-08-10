from typing import Optional, Any, Dict, List, Union
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from ytelegraph import TelegraphAPI


class YTGCreatePage(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: Dict[str, Any],
    ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
        invoke tools
        """
        title = tool_parameters.get("title")
        content = tool_parameters.get("content")
        author_name = tool_parameters.get("author_name", "")
        author_url = tool_parameters.get("author_url", "")
        ph = TelegraphAPI(self.runtime.credentials.get("access_token"))
        ph_link = ph.create_page_md(title, content, author_name, author_url)
        return self.create_text_message(ph_link)
