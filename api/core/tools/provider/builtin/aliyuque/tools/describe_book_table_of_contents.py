#!/usr/bin/env python3
"""
获取知识库目录
"""

__author__ = "佐井"
__created__ = "2024-09-17 15:17:11"

from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.aliyuque.tools.base import AliYuqueTool
from core.tools.tool.builtin_tool import BuiltinTool


class YuqueDescribeBookTableOfContentsTool(AliYuqueTool, BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> (Union)[ToolInvokeMessage, list[ToolInvokeMessage]]:
        token = self.runtime.credentials.get("token", None)
        if not token:
            raise Exception("token is required")
        return self.create_text_message(self.request("GET", token, tool_parameters, "/api/v2/repos/{book_id}/toc"))
