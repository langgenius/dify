from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GitlabFilesTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
                tool_parameters: dict[str, Any]
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        
        project = tool_parameters.get('project', '')
        branch = tool_parameters.get('branch', '')
        path = tool_parameters.get('path', '')


        if not project:
            return self.create_text_message('Project is required')
        if not branch:
            return self.create_text_message('Branch is required')

        if not path:
            return self.create_text_message('Path is required')

        access_token = self.runtime.credentials.get('access_tokens')
        site_url = self.runtime.credentials.get('site_url')

        if 'access_tokens' not in self.runtime.credentials or not self.runtime.credentials.get('access_tokens'):
            return self.create_text_message("Gitlab API Access Tokens is required.")
        if 'site_url' not in self.runtime.credentials or not self.runtime.credentials.get('site_url'):
            site_url = 'https://gitlab.com'
    
        # Get project ID from project name
        project_id = self.get_project_id(site_url, access_token, project)
        if not project_id:
            return self.create_text_message(f"Project '{project}' not found.")

        # Get commit content
        result = self.fetch(user_id, project_id, site_url, access_token, branch, path)

        return [self.create_json_message(item) for item in result]
    
    def extract_project_name_and_path(self, path: str) -> tuple[str, str]:
        parts = path.split('/', 1)
        if len(parts) < 2:
            return None, None
        return parts[0], parts[1]

    def get_project_id(self, site_url: str, access_token: str, project_name: str) -> Union[str, None]:
        headers = {"PRIVATE-TOKEN": access_token}
        try:
            url = f"{site_url}/api/v4/projects?search={project_name}"
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            projects = response.json()
            for project in projects:
                if project['name'] == project_name:
                    return project['id']
        except requests.RequestException as e:
            print(f"Error fetching project ID from GitLab: {e}")
        return None
    
    def fetch(self,user_id: str, project_id: str, site_url: str, access_token: str, branch: str, path: str = None) -> list[dict[str, Any]]:
        domain = site_url
        headers = {"PRIVATE-TOKEN": access_token}
        results = []

        try:
            # List files and directories in the given path
            url = f"{domain}/api/v4/projects/{project_id}/repository/tree?path={path}&ref={branch}"
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            items = response.json()

            for item in items:
                item_path = item['path']
                if item['type'] == 'tree':  # It's a directory
                    results.extend(self.fetch(project_id, site_url, access_token, branch, item_path))
                else:  # It's a file
                    file_url = f"{domain}/api/v4/projects/{project_id}/repository/files/{item_path}/raw?ref={branch}"
                    file_response = requests.get(file_url, headers=headers)
                    file_response.raise_for_status()
                    file_content = file_response.text
                    results.append({
                        "path": item_path,
                        "branch": branch,
                        "content": file_content
                    })
        except requests.RequestException as e:
            print(f"Error fetching data from GitLab: {e}")
        
        return results