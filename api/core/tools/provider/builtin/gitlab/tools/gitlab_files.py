import urllib.parse
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GitlabFilesTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        repository = tool_parameters.get("repository", "")
        project = tool_parameters.get("project", "")
        branch = tool_parameters.get("branch", "")
        path = tool_parameters.get("path", "")
        file_path = tool_parameters.get("file_path", "")

        if not repository and not project:
            return self.create_text_message("Either repository or project is required")
        if not branch:
            return self.create_text_message("Branch is required")
        if not path and not file_path:
            return self.create_text_message("Either path or file_path is required")

        access_token = self.runtime.credentials.get("access_tokens")
        headers = {"PRIVATE-TOKEN": access_token}
        site_url = self.runtime.credentials.get("site_url")

        if "access_tokens" not in self.runtime.credentials or not self.runtime.credentials.get("access_tokens"):
            return self.create_text_message("Gitlab API Access Tokens is required.")
        if "site_url" not in self.runtime.credentials or not self.runtime.credentials.get("site_url"):
            site_url = "https://gitlab.com"

        if repository:
            # URL encode the repository path
            identifier = urllib.parse.quote(repository, safe="")
        else:
            identifier = self.get_project_id(site_url, access_token, project)
            if not identifier:
                raise Exception(f"Project '{project}' not found.)")

        # Get file content
        if path:
            results = self.fetch_files(site_url, headers, identifier, branch, path)
            return [self.create_json_message(item) for item in results]
        else:
            result = self.fetch_file(site_url, headers, identifier, branch, file_path)
            return [self.create_json_message(result)]

    @staticmethod
    def fetch_file(
        site_url: str,
        headers: dict[str, str],
        identifier: str,
        branch: str,
        path: str,
    ) -> dict[str, Any]:
        encoded_file_path = urllib.parse.quote(path, safe="")
        file_url = f"{site_url}/api/v4/projects/{identifier}/repository/files/{encoded_file_path}/raw?ref={branch}"

        file_response = requests.get(file_url, headers=headers)
        file_response.raise_for_status()
        file_content = file_response.text
        return {"path": path, "branch": branch, "content": file_content}

    def fetch_files(
        self, site_url: str, headers: dict[str, str], identifier: str, branch: str, path: str
    ) -> list[dict[str, Any]]:
        results = []

        try:
            tree_url = f"{site_url}/api/v4/projects/{identifier}/repository/tree?path={path}&ref={branch}"
            response = requests.get(tree_url, headers=headers)
            response.raise_for_status()
            items = response.json()

            for item in items:
                item_path = item["path"]
                if item["type"] == "tree":  # It's a directory
                    results.extend(self.fetch_files(site_url, headers, identifier, branch, item_path))
                else:  # It's a file
                    result = self.fetch_file(site_url, headers, identifier, branch, item_path)
                    results.append(result)
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
