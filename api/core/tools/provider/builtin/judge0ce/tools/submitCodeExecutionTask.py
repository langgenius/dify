import json
from typing import Any, Union

from httpx import post

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SubmitCodeExecutionTaskTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        api_key = self.runtime.credentials['X-RapidAPI-Key']

        source_code = tool_parameters['source_code']
        language_id = tool_parameters['language_id']
        stdin = tool_parameters.get('stdin', '')
        expected_output = tool_parameters.get('expected_output', '')
        additional_files = tool_parameters.get('additional_files', '')

        url = "https://judge0-ce.p.rapidapi.com/submissions"

        querystring = {"base64_encoded": "false", "fields": "*"}

        payload = {
            "language_id": language_id,
            "source_code": source_code,
            "stdin": stdin,
            "expected_output": expected_output,
            "additional_files": additional_files,
        }

        headers = {
            "content-type": "application/json",
            "Content-Type": "application/json",
            "X-RapidAPI-Key": api_key,
            "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com"
        }

        response = post(url, data=json.dumps(payload), headers=headers, params=querystring)

        if response.status_code != 201:
            raise Exception(response.text)

        token = response.json()['token']

        return self.create_text_message(text=token)