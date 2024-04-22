from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool.tool import Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.judge0ce.tools.submitCodeExecutionTask import SubmitCodeExecutionTaskTool
from core.tools.provider.builtin.judge0ce.tools.getExecutionResult import GetExecutionResultTool

from typing import Any, Dict

class Judge0CEProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            SubmitCodeExecutionTaskTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "source_code": "print('Hello, World!')",
                    "language_id": 71,  # Python 3
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))