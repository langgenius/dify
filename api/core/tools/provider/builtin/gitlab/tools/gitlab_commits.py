import json
from datetime import datetime, timedelta
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GitlabCommitsTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
                tool_parameters: dict[str, Any]
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        project = tool_parameters.get('project', '')
        employee = tool_parameters.get('employee', '')
        start_time = tool_parameters.get('start_time', '')
        end_time = tool_parameters.get('end_time', '')

        if not project:
            return self.create_text_message('Project is required')

        if not start_time:
            start_time = (datetime.utcnow() - timedelta(days=1)).isoformat()
        if not end_time:
            end_time = datetime.utcnow().isoformat()

        access_token = self.runtime.credentials.get('access_tokens')
        site_url = self.runtime.credentials.get('site_url')

        if 'access_tokens' not in self.runtime.credentials or not self.runtime.credentials.get('access_tokens'):
            return self.create_text_message("Gitlab API Access Tokens is required.")
        if 'site_url' not in self.runtime.credentials or not self.runtime.credentials.get('site_url'):
            site_url = 'https://gitlab.com'
        
        # Get commit content
        result = self.fetch(user_id, site_url, access_token, project, employee, start_time, end_time)

        return self.create_text_message(json.dumps(result, ensure_ascii=False))
    
    def fetch(self,user_id: str, site_url: str, access_token: str, project: str, employee: str = None, start_time: str = '', end_time: str = '') -> list[dict[str, Any]]:
        domain = site_url
        headers = {"PRIVATE-TOKEN": access_token}
        results = []

        try:
            # Get all of projects
            url = f"{domain}/api/v4/projects"
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            projects = response.json()

            filtered_projects = [p for p in projects if project == "*" or p['name'] == project]

            for project in filtered_projects:
                project_id = project['id']
                project_name = project['name']
                print(f"Project: {project_name}")

                # Get all of proejct commits
                commits_url = f"{domain}/api/v4/projects/{project_id}/repository/commits"
                params = {
                    'since': start_time,
                    'until': end_time
                }
                if employee:
                    params['author'] = employee

                commits_response = requests.get(commits_url, headers=headers, params=params)
                commits_response.raise_for_status()
                commits = commits_response.json()

                for commit in commits:
                    commit_sha = commit['id']
                    print(f"\tCommit SHA: {commit_sha}")

                    diff_url = f"{domain}/api/v4/projects/{project_id}/repository/commits/{commit_sha}/diff"
                    diff_response = requests.get(diff_url, headers=headers)
                    diff_response.raise_for_status()
                    diffs = diff_response.json()
                    
                    for diff in diffs:
                        # Caculate code lines of changed
                        added_lines = diff['diff'].count('\n+')
                        removed_lines = diff['diff'].count('\n-')
                        total_changes = added_lines + removed_lines

                        if total_changes > 1:
                            final_code = ''.join([line[1:] for line in diff['diff'].split('\n') if line.startswith('+') and not line.startswith('+++')])
                            results.append({
                                "project": project_name,
                                "commit_sha": commit_sha,
                                "diff": final_code
                            })
                            print(f"Commit code:{final_code}")
        except requests.RequestException as e:
            print(f"Error fetching data from GitLab: {e}")
        
        return results