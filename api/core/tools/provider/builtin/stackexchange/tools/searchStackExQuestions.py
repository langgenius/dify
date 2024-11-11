from typing import Any, Union

import requests
from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SearchStackExQuestionsInput(BaseModel):
    intitle: str = Field(..., description="The search query.")
    sort: str = Field(..., description="The sort order - relevance, activity, votes, creation.")
    order: str = Field(..., description="asc or desc")
    site: str = Field(..., description="The Stack Exchange site.")
    tagged: str = Field(None, description="Semicolon-separated tags to include.")
    nottagged: str = Field(None, description="Semicolon-separated tags to exclude.")
    accepted: bool = Field(..., description="true for only accepted answers, false otherwise")
    pagesize: int = Field(..., description="Number of results per page")


class SearchStackExQuestionsTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        input = SearchStackExQuestionsInput(**tool_parameters)

        params = {
            "intitle": input.intitle,
            "sort": input.sort,
            "order": input.order,
            "site": input.site,
            "accepted": input.accepted,
            "pagesize": input.pagesize,
        }
        if input.tagged:
            params["tagged"] = input.tagged
        if input.nottagged:
            params["nottagged"] = input.nottagged

        response = requests.get("https://api.stackexchange.com/2.3/search", params=params)

        if response.status_code == 200:
            return self.create_text_message(self.summary(user_id=user_id, content=response.text))
        else:
            return self.create_text_message(f"API request failed with status code {response.status_code}")
