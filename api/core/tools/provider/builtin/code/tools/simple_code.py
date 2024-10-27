from typing import Any

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SimpleCode(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
            invoke simple code
        """

        language = tool_parameters.get('language', CodeLanguage.PYTHON3)
        code = tool_parameters.get('code', '')

        if language not in [CodeLanguage.PYTHON3, CodeLanguage.JAVASCRIPT]:
            raise ValueError(f'Only python3 and javascript are supported, not {language}')
        
        result = CodeExecutor.execute_code(language, '', code)

        return self.create_text_message(result)