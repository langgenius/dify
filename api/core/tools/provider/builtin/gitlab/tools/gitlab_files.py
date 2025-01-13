import urllib.parse
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GitlabFilesTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        project = tool_parameters.get("project", "")
        repository = tool_parameters.get("repository", "")
        branch = tool_parameters.get("branch", "")
        path = tool_parameters.get("path", "")

        if not project and not repository:
            return self.create_text_message("Either project or repository is required")
        if not branch:
            return self.create_text_message("Branch is required")
        if not path:
            return self.create_text_message("Path is required")

        access_token = self.runtime.credentials.get("access_tokens")
        site_url = self.runtime.credentials.get("site_url")

        if "access_tokens" not in self.runtime.credentials or not self.runtime.credentials.get("access_tokens"):
            return self.create_text_message("Gitlab API Access Tokens is required.")
        if "site_url" not in self.runtime.credentials or not self.runtime.credentials.get("site_url"):
            site_url = "https://gitlab.com"

        # Get file content
        if repository:
            result = self.fetch_files(site_url, access_token, repository, branch, path, is_repository=True)
        else:
            result = self.fetch_files(site_url, access_token, project, branch, path, is_repository=False)

        return [self.create_json_message(item) for item in result]

    def fetch_files(
        self, site_url: str, access_token: str, identifier: str, branch: str, path: str, is_repository: bool
    ) -> list[dict[str, Any]]:
        domain = site_url
        headers = {"PRIVATE-TOKEN": access_token}
        results = []

        try:
            if is_repository:
                # URL encode the repository path
                encoded_identifier = urllib.parse.quote(identifier, safe="")
                tree_url = f"{domain}/api/v4/projects/{encoded_identifier}/repository/tree?path={path}&ref={branch}"
            else:
                # Get project ID from project name
                project_id = self.get_project_id(site_url, access_token, identifier)
                if not project_id:
                    return self.create_text_message(f"Project '{identifier}' not found.")
                tree_url = f"{domain}/api/v4/projects/{project_id}/repository/tree?path={path}&ref={branch}"

            response = requests.get(tree_url, headers=headers)
            response.raise_for_status()
            items = response.json()

            for item in items:
                item_path = item["path"]
                if item["type"] == "tree":  # It's a directory
                    results.extend(
                        self.fetch_files(site_url, access_token, identifier, branch, item_path, is_repository)
                    )
                else:  # It's a file
                    encoded_item_path = urllib.parse.quote(item_path, safe="")
                    if is_repository:
                        file_url = (
                            f"{domain}/api/v4/projects/{encoded_identifier}/repository/files"
                            f"/{encoded_item_path}/raw?ref={branch}"
                        )
                    else:
                        file_url = (
                            f"{domain}/api/v4/projects/{project_id}/repository/files"
                            f"{encoded_item_path}/raw?ref={branch}"
                        )

                    file_response = requests.get(file_url, headers=headers)
                    file_response.raise_for_status()
                    file_content = file_response.text
                    results.append({"path": item_path, "branch": branch, "content": file_content})
        except requests.RequestException as e:
            print(f"Error fetching data from GitLab: {e}")

        return results

    def get_project_id(self, site_url: str, access_token: str, project_name: str) -> Union[str, None]:
        headers = {"PRIVATE-TOKEN": access_token}
        try:
            url = f"{site_url}/api/v4/projects?search={project_name}"
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            projects = response.json()
            for project in projects:
                if project["name"] == project_name:
                    return project["id"]
        except requests.RequestException as e:
            print(f"Error fetching project ID from GitLab: {e}")
        return None
