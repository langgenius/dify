from typing import Any, Union

from py_trans import PyTranslator

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GoogleTranslate(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # get content
        content = tool_parameters.get('content', '')
        if not content:
            return self.create_text_message('Invalid parameter content')
        
        # get json filter
        dest = tool_parameters.get('dest', '')
        if not dest:
            return self.create_text_message('Invalid parameter destination language')

        try:
            result = self._translate(content, dest)
            return self.create_text_message(str(result))
        except Exception:
            return self.create_text_message('Translation service error, please check the network')

    # Extract data from JSON content
    def _translate(self, content: str, dest: str) -> str:
        try:
            tr = PyTranslator()
            response_json = tr.google(content, dest)
            translation = response_json['translation']
            return str(translation)

        except Exception as e:
            return str(e)