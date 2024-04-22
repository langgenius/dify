from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage

from typing import Any, Dict, List, Union
import requests

class GetExecutionResultTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
                tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        api_key = self.runtime.credentials['X-RapidAPI-Key']
        
        url = f"https://judge0-ce.p.rapidapi.com/submissions/{tool_parameters['token']}"
        headers = {
            "X-RapidAPI-Key": api_key
        }
        
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            result = response.json()
            return self.create_text_message(text=f"Submission details:\n"
                                                 f"stdout: {result.get('stdout', '')}\n"
                                                 f"stderr: {result.get('stderr', '')}\n"
                                                 f"compile_output: {result.get('compile_output', '')}\n"
                                                 f"message: {result.get('message', '')}\n"
                                                 f"status: {result['status']['description']}\n"
                                                 f"time: {result.get('time', '')} seconds\n"
                                                 f"memory: {result.get('memory', '')} bytes")
        else:
            return self.create_text_message(text=f"Error retrieving submission details: {response.text}")