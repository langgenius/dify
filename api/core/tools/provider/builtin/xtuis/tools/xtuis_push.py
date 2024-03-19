import os
import sys
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class xtuis_push_tool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        
        title = tool_parameters['title']
        desp = tool_parameters['desp']
        xtuis_api_key = self.runtime.credentials['xtuis_api_key']
        
        if not title:
            return self.create_text_message('title is required')
        if not desp:
            return self.create_text_message('desp is required!') 
        
        if not xtuis_api_key:
            return self.create_text_message('xtuis_api_key is required!')       
        

        api_url = 'https://wx.xtuis.cn/xtuis_api_key.send'
        headers = {
            'xtuis_api_key': xtuis_api_key,
            'Content-Type': 'application/text'
        }
        mypostdata={'text':title,'desp':desp}
        
        try:
            res = httpx.post(api_url,headers=headers,data=mypostdata)
            if res.is_success:
                return self.create_text_message("Text message sent to weixin successfully")
            else:
                return self.create_text_message(
                    f"Failed to send the text message, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to send message to weixin. {}".format(e))
