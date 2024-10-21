import json
from typing import Any, Union

import requests
from httpx import post

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class ExecuteCodeTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        api_key = self.runtime.credentials["X-RapidAPI-Key"]

        url = "https://judge0-ce.p.rapidapi.com/submissions"

        querystring = {"base64_encoded": "false", "fields": "*"}

        headers = {
            "Content-Type": "application/json",
            "X-RapidAPI-Key": api_key,
            "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
        }

        payload = {
            "language_id": tool_parameters["language_id"],
            "source_code": tool_parameters["source_code"],
            "stdin": tool_parameters.get("stdin", ""),
            "expected_output": tool_parameters.get("expected_output", ""),
            "additional_files": tool_parameters.get("additional_files", ""),
        }

        response = post(url, data=json.dumps(payload), headers=headers, params=querystring)

        if response.status_code != 201:
            raise Exception(response.text)

        token = response.json()["token"]

        url = f"https://judge0-ce.p.rapidapi.com/submissions/{token}"
        headers = {"X-RapidAPI-Key": api_key}

        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            result = response.json()
            return self.create_text_message(
                text=f"stdout: {result.get('stdout', '')}\n"
                f"stderr: {result.get('stderr', '')}\n"
                f"compile_output: {result.get('compile_output', '')}\n"
                f"message: {result.get('message', '')}\n"
                f"status: {result['status']['description']}\n"
                f"time: {result.get('time', '')} seconds\n"
                f"memory: {result.get('memory', '')} bytes"
            )
        else:
            return self.create_text_message(text=f"Error retrieving submission details: {response.text}")
