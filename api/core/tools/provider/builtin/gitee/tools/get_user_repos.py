import urllib.parse
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GiteeUserReposTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        visibility = tool_parameters.get("visibility", "all")
        affiliation = tool_parameters.get("affiliation", "")
        type = tool_parameters.get("type", "")
        sort = tool_parameters.get("sort", "full_name")
        direction = tool_parameters.get("direction", "desc")
        q = tool_parameters.get("q", "")
        page = tool_parameters.get("page", 1)
        per_page = tool_parameters.get("per_page", 20)

        access_token = self.runtime.credentials.get("access_tokens")
        host_url = self.runtime.credentials.get("host_url")

        if not access_token:
            return self.create_text_message("Gitee API Access Token is required.")
        
        result = self.fetch_repos(
            host_url, 
            access_token, 
            visibility, 
            affiliation, 
            type, 
            sort, 
            direction, 
            q, 
            page, 
            per_page
            )

        return [self.create_json_message(item) for item in result]
    
    def fetch_repos(
            self,
            host_url: str,
            access_token: str,
            visibility: str,
            affiliation: str,
            type: str,
            sort: str,
            direction: str,
            q: str,
            page: str,
            per_page: str,
    ) -> list[dict[str, Any]]:
        headers = {"Authorization": f"token {access_token}"}
        results = []
        base_url = f"{host_url}/api/v5/user/repos?"
        params = []

        if q:
            encoded_q = urllib.parse.quote(q, safe="")
            params.append(f"q={encoded_q}")
        if visibility:
            params.append(f"visibility={visibility}")
        if affiliation:
            params.append(f"affiliation={affiliation}")
        if not visibility and not affiliation and type:
            params.append(f"type={type}")
        if sort:
            params.append(f"sort={sort}")
        if direction:
            params.append(f"direction={direction}")
        if page:
            params.append(f"page={page}")
        if per_page:
            params.append(f"per_page={per_page}")

        fetch_repos_url = base_url + "&".join(params)

        try:
            response = requests.get(fetch_repos_url, headers=headers)
            response.raise_for_status()
            repos = response.json()

            for repo in repos:
                results.append(
                    {
                        "id": repo["id"],
                        "name": repo["name"],
                        "description": repo["description"],
                        "status": repo["status"],
                        "private": repo["private"],
                        "path": repo["path"],
                        "url": repo["html_url"],
                        "created_at": repo["created_at"],
                        "updated_at": repo["updated_at"],
                        "default_branch": repo["default_branch"],
                    }
                )
            print(results)
        except requests.RequestException as e:
            print(f"Error fetching data from Gitee: {e}")
        
        return results