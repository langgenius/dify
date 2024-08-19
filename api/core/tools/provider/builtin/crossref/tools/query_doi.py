import time
from typing import Any, Union

import requests
from core.tools.errors import ToolParameterValidationError
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class CrossRefQueryDOITool(BuiltinTool):
    # doc: https://github.com/CrossRef/rest-api-doc
    interval: float = 0.5

    def query(self, doi: str) -> dict:
        url = f"https://api.crossref.org/works/{doi}"
        response = requests.get(url)
        time.sleep(self.interval)
        response.raise_for_status()
        response = response.json()

        if response['status'] != 'ok':
            return {}

        message = response['message']
        return message

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        doi = tool_parameters.get('doi')
        if not doi:
            raise ToolParameterValidationError('doi is required.')

        return self.create_json_message(self.query(doi))
