import urllib.parse
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GitlabMergeRequestsTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        repository = tool_parameters.get("repository", "")
        branch = tool_parameters.get("branch", "")
        start_time = tool_parameters.get("start_time", "")
        end_time = tool_parameters.get("end_time", "")
        state = tool_parameters.get("state", "opened")  # Default to "opened"

        if not repository:
            return self.create_text_message("Repository is required")

        access_token = self.runtime.credentials.get("access_tokens")
        site_url = self.runtime.credentials.get("site_url")

        if not access_token:
            return self.create_text_message("Gitlab API Access Tokens is required.")
        if not site_url:
            site_url = "https://gitlab.com"

        # Get merge requests
        result = self.get_merge_requests(site_url, access_token, repository, branch, start_time, end_time, state)

        return [self.create_json_message(item) for item in result]

    def get_merge_requests(
        self, site_url: str, access_token: str, repository: str, branch: str, start_time: str, end_time: str, state: str
    ) -> list[dict[str, Any]]:
        domain = site_url
        headers = {"PRIVATE-TOKEN": access_token}
        results = []

        try:
            # URL encode the repository path
            encoded_repository = urllib.parse.quote(repository, safe="")
            merge_requests_url = f"{domain}/api/v4/projects/{encoded_repository}/merge_requests"
            params = {"state": state}

            # Add time filters if provided
            if start_time:
                params["created_after"] = start_time
            if end_time:
                params["created_before"] = end_time

            response = requests.get(merge_requests_url, headers=headers, params=params)
            response.raise_for_status()
            merge_requests = response.json()

            for mr in merge_requests:
                # Filter by target branch
                if branch and mr["target_branch"] != branch:
                    continue

                results.append(
                    {
                        "id": mr["id"],
                        "title": mr["title"],
                        "author": mr["author"]["name"],
                        "web_url": mr["web_url"],
                        "target_branch": mr["target_branch"],
                        "created_at": mr["created_at"],
                        "state": mr["state"],
                    }
                )
        except requests.RequestException as e:
            print(f"Error fetching merge requests from GitLab: {e}")

        return results
