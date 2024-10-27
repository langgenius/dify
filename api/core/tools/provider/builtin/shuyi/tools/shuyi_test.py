from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class ShuyiTestTool(BuiltinTool):

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        params = {
            "api_key": self.runtime.credentials['shuyi_api_key'],
            "api_url": self.runtime.credentials['shuyi_api_url'],
            "type": tool_parameters['type'],
            "query": tool_parameters['query'],
        }
        image_path = 'https://buffer.com/cdn-cgi/image/w=1000,fit=contain,q=90,f=auto/library/content/images/size/w1200/2023/10/free-images.jpg'
        file_path = '/Users/shuyi/Downloads/streamlit/demo.xlsx'
        link = 'https://blog.tupu.work'
        with open(file_path, 'rb') as image:
            byte_arr = image.read()

        messages = [
            self.create_text_message(
                """ ### User message
%s
### 生成式 AI 应用创新引擎
开源的 LLM 应用开发平台，轻松构建和运营生成式 AI 原生应用。
- 生成式 AI
- 应用开发框架

![image](https://buffer.com/cdn-cgi/image/w=1000,fit=contain,q=90,f=auto/library/content/images/size/w1200/2023/10/free-images.jpg)

#### RAG Pipeline
""" % params['query']),
            self.create_json_message({'result': 'success', 'text': 'This is a message'}),
            self.create_image_message(image_path),
            self.create_link_message(link),
            self.create_blob_message(
                blob=byte_arr,
                meta={
                    'mime_type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                },
                save_as=self.VARIABLE_KEY.IMAGE.value
            )
        ]

        match params['type']:
            case 'text':
                return messages[0]
            case 'json':
                return messages[1]
            case 'image':
                return messages[2]
            case 'link':
                return messages[3]
            case 'blob':
                return messages[4]
            case 'mix':
                return messages
        return self.create_text_message('Error Type')
