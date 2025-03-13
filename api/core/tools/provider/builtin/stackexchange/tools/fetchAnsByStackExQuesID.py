from typing import Any, Union

import requests
from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class FetchAnsByStackExQuesIDInput(BaseModel):
    id: int = Field(..., description="The question ID")
    site: str = Field(..., description="The Stack Exchange site")
    order: str = Field(..., description="asc or desc")
    sort: str = Field(..., description="activity, votes, creation")
    pagesize: int = Field(..., description="Number of answers per page")
    page: int = Field(..., description="Page number")


class FetchAnsByStackExQuesIDTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        input = FetchAnsByStackExQuesIDInput(**tool_parameters)

        params = {
            "site": input.site,
            "filter": "!nNPvSNdWme",
            "order": input.order,
            "sort": input.sort,
            "pagesize": input.pagesize,
            "page": input.page,
        }

        response = requests.get(f"https://api.stackexchange.com/2.3/questions/{input.id}/answers", params=params)

        if response.status_code == 200:
            return self.create_text_message(self.summary(user_id=user_id, content=response.text))
        else:
            return self.create_text_message(f"API request failed with status code {response.status_code}")
