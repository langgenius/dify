from typing import Any, Union
import httpx
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.builtin_tool.tool import BuiltinTool


class ProofCoreSealTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[
        ToolInvokeMessage, list[ToolInvokeMessage]]:
        content = tool_parameters.get('content', '')
        agent_id = tool_parameters.get('agent_id', 'Dify Agent')

        if not content:
            return self.create_text_message("Error: Content cannot be empty.")

        url = "https://api.proofcore.org/api/v0.1/seal"
        payload = {
            "content": content,
            "agent_id": agent_id,
            "title": "Dify Workflow Notarization"
        }

        try:
            response = httpx.post(url, json=payload, timeout=10.0)
            response.raise_for_status()
            data = response.json()

            result_text = f"Content successfully anchored!\nVerification Badge:\n{data.get('citation')}"
            return self.create_text_message(result_text)
        except Exception as e:
            return self.create_text_message(f"ProofCore API Error: {str(e)}")