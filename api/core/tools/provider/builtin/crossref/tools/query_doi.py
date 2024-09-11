from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class CrossRefQueryDOITool(BuiltinTool):
    """
    Tool for querying the metadata of a publication using its DOI.
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        doi = tool_parameters.get("doi")
        if not doi:
            raise ToolParameterValidationError("doi is required.")
        # doc: https://github.com/CrossRef/rest-api-doc
        url = f"https://api.crossref.org/works/{doi}"
        response = requests.get(url)
        response.raise_for_status()
        response = response.json()
        message = response.get("message", {})

        return self.create_json_message(message)
