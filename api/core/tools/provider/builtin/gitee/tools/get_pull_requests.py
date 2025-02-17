from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GiteeReposPullRequestsTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        owner = tool_parameters.get("owner")
        repo = tool_parameters.get("repo")
        state = tool_parameters.get("state", "open")
        head = tool_parameters.get("head")
        base = tool_parameters.get("base")
        sort = tool_parameters.get("sort", "created")
        direction = tool_parameters.get("direction", "desc")
        since = tool_parameters.get("since")
        labels = tool_parameters.get("labels")
        author = tool_parameters.get("author")
        assignee = tool_parameters.get("assignee")
        tester = tool_parameters.get("tester")
        page = tool_parameters.get("page", 1)
        per_page = tool_parameters.get("per_page", 20)

        access_token = self.runtime.credentials.get("access_tokens")
        host_url = self.runtime.credentials.get("host_url")

        if not access_token:
            return self.create_text_message("Gitee API Access Token is required.")

        if not owner or not repo:
            return self.create_text_message("owner and repo are required.")

        result = self.fetch_pull_requests(
            host_url,
            access_token,
            owner,
            repo,
            state,
            head,
            base,
            sort,
            direction,
            since,
            labels,
            author,
            assignee,
            tester,
            page,
            per_page,
        )

        return [self.create_json_message(item) for item in result]

    def fetch_pull_requests(
        self,
        host_url: str,
        access_token: str,
        owner: str,
        repo: str,
        state: str,
        head: str,
        base: str,
        sort: str,
        direction: str,
        since: str,
        labels: str,
        author: str,
        assignee: str,
        tester: str,
        page: str,
        per_page: str,
    ) -> list[dict[str, Any]]:
        headers = {"Authorization": f"token {access_token}"}
        results = []
        base_url = f"{host_url}/api/v5/repos/{owner}/{repo}/pulls?"
        params = []
        if state:
            params.append(f"state={state}")
        if head:
            params.append(f"head={head}")
        if base:
            params.append(f"base={base}")
        if sort:
            params.append(f"sort={sort}")
        if direction:
            params.append(f"direction={direction}")
        if since:
            params.append(f"since={since}")
        if labels:
            params.append(f"labels={labels}")
        if author:
            params.append(f"author={author}")
        if assignee:
            params.append(f"assignee={assignee}")
        if tester:
            params.append(f"tester={tester}")
        if page:
            params.append(f"page={page}")
        if per_page:
            params.append(f"per_page={per_page}")

        fetch_pull_requests_url = base_url + "&".join(params)

        try:
            response = requests.get(fetch_pull_requests_url, headers=headers)
            response.raise_for_status()
            pull_requests = response.json()
            for pull_request in pull_requests:
                results.append(
                    {
                        "id": pull_request["id"],
                        "number": pull_request["number"],
                        "title": pull_request["title"],
                        "state": pull_request["state"],
                        "created_at": pull_request["created_at"],
                        "updated_at": pull_request["updated_at"],
                        "closed_at": pull_request["closed_at"],
                        "merged_at": pull_request["merged_at"],
                        "mergeable": pull_request["mergeable"],
                        "url": pull_request["html_url"],
                        "assignees": pull_request["assignees"],
                        "testers": pull_request["testers"],
                        "draft": pull_request["draft"],
                        "head": pull_request["head"]["label"],
                        "base": pull_request["base"]["label"],
                        "labels": pull_request["labels"],
                    }
                )
        except requests.RequestException as e:
            print(f"Error fetching data from Gitee: {e}")

        return results
