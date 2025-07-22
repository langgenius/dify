from collections.abc import Generator
from typing import Any, Optional

from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class SimpleCode(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke simple code
        """

        language = tool_parameters.get("language", CodeLanguage.PYTHON3)
        code = tool_parameters.get("code", "")

        if language not in {CodeLanguage.PYTHON3, CodeLanguage.JAVASCRIPT}:
            raise ValueError(f"Only python3 and javascript are supported, not {language}")

        try:
            result = CodeExecutor.execute_code(language, "", code)
            yield self.create_text_message(result)
        except Exception as e:
            raise ToolInvokeError(str(e))
