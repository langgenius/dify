from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage

from typing import Any, Union

class SubmitCodeExecutionTaskTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        api_key = self.runtime.credentials['X-RapidAPI-Key']
        
        url = "https://judge0-ce.p.rapidapi.com/submissions"
        headers = {
            "X-RapidAPI-Key": api_key,
            "Content-Type": "application/json"
        }
        
        payload = {
            "source_code": tool_parameters['source_code'],
            "language_id": tool_parameters['language_id'],
            "stdin": tool_parameters.get('stdin', ''),
            "expected_output": tool_parameters.get('expected_output', ''),
            "additional_files": tool_parameters.get('additional_files', '')
        }
        
        response = requests.post(url, json=payload, headers=headers)
        
        if response.status_code == 201:
            token = response.json()['token']
            return self.create_text_message(text=f"Submission created successfully. Token: {token}")
        else:
            return self.create_text_message(text=f"Error creating submission: {response.text}")