import logging
from typing import Any, cast

import httpx

from core.helper.ssrf_proxy import make_request
from models.github_connection import GitHubConnection

logger = logging.getLogger(__name__)

GITHUB_API_BASE_URL = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"  # GitHub API version


class GitHubAPIClient:
    """
    GitHub API client wrapper for repository operations.
    """

    def __init__(self, connection: GitHubConnection | Any):
        """
        Initialize GitHub API client with connection.

        Args:
            connection: GitHubConnection instance or any object with get_decrypted_access_token() method
        """
        self.connection = connection
        # Support both GitHubConnection and temporary connection objects
        if hasattr(connection, "get_decrypted_access_token"):
            self.access_token = connection.get_decrypted_access_token()
        elif hasattr(connection, "access_token"):
            self.access_token = connection.access_token
        else:
            raise ValueError("Connection must have get_decrypted_access_token() method or access_token attribute")
        self.base_url = GITHUB_API_BASE_URL

    def _get_headers(self) -> dict[str, str]:
        """Get default headers for GitHub API requests."""
        return {
            "Authorization": f"token {self.access_token}",
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        }

    def _request(
        self,
        method: str,
        endpoint: str,
        params: dict[str, Any] | None = None,
        json_data: dict[str, Any] | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any] | list[dict[str, Any]]:
        """
        Make HTTP request to GitHub API.

        Args:
            method: HTTP method
            endpoint: API endpoint (relative to base URL)
            params: Query parameters
            json_data: JSON body data
            timeout: Request timeout

        Returns:
            Response JSON data
        """
        url = f"{self.base_url}{endpoint}"
        headers = self._get_headers()

        try:
            response = make_request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json_data,
                timeout=timeout,
            )
            response.raise_for_status()

            # Handle empty responses
            if response.status_code == 204 or not response.content:
                return {}

            return response.json()
        except httpx.HTTPStatusError as e:
            logger.exception(
                "GitHub API error: method=%s, endpoint=%s, status=%s, response=%s",
                method,
                endpoint,
                e.response.status_code,
                e.response.text,
            )
            raise ValueError(f"GitHub API error: {e.response.status_code} - {e.response.text}") from e
        except httpx.HTTPError as e:
            logger.exception("HTTP error during GitHub API request")
            raise ValueError(f"Failed to connect to GitHub API: {str(e)}") from e

    def get_repository_info(self) -> dict[str, Any]:
        """
        Get repository information.

        Returns:
            Repository information
        """
        endpoint = f"/repos/{self.connection.repository_full_name}"
        result = self._request("GET", endpoint)
        return cast(dict[str, Any], result)

    def list_branches(self) -> list[dict[str, Any]]:
        """
        List all branches in the repository.

        Returns:
            List of branch information
        """
        endpoint = f"/repos/{self.connection.repository_full_name}/branches"
        result = self._request("GET", endpoint)
        return cast(list[dict[str, Any]], result)

    def get_branch(self, branch_name: str) -> dict[str, Any]:
        """
        Get specific branch information.

        Args:
            branch_name: Branch name

        Returns:
            Branch information
        """
        endpoint = f"/repos/{self.connection.repository_full_name}/branches/{branch_name}"
        result = self._request("GET", endpoint)
        return cast(dict[str, Any], result)

    def create_branch(self, branch_name: str, from_branch: str = "main") -> dict[str, Any]:
        """
        Create a new branch from an existing branch.

        Args:
            branch_name: New branch name
            from_branch: Source branch name

        Returns:
            Created branch information
        """
        # Get SHA of the source branch
        source_branch = self.get_branch(from_branch)
        sha = source_branch["commit"]["sha"]

        # Create reference for new branch
        endpoint = f"/repos/{self.connection.repository_full_name}/git/refs"
        data = {
            "ref": f"refs/heads/{branch_name}",
            "sha": sha,
        }
        return self._request("POST", endpoint, json_data=data)

    def get_file_content(self, path: str, branch: str | None = None) -> dict[str, Any]:
        """
        Get file content from repository.

        Args:
            path: File path in repository
            branch: Branch name (defaults to connection's branch)

        Returns:
            File content information
        """
        branch = branch or self.connection.branch
        endpoint = f"/repos/{self.connection.repository_full_name}/contents/{path}"
        params = {"ref": branch}
        result = self._request("GET", endpoint, params=params)
        return cast(dict[str, Any], result)

    def create_or_update_file(
        self,
        path: str,
        content: str,
        message: str,
        branch: str | None = None,
        sha: str | None = None,
    ) -> dict[str, Any]:
        """
        Create or update a file in the repository.

        Args:
            path: File path in repository
            content: File content (base64 encoded)
            message: Commit message
            branch: Branch name (defaults to connection's branch)
            sha: File SHA for updates (required for updates)

        Returns:
            Commit information
        """
        branch = branch or self.connection.branch
        endpoint = f"/repos/{self.connection.repository_full_name}/contents/{path}"

        data = {
            "message": message,
            "content": content,
            "branch": branch,
        }

        if sha:
            data["sha"] = sha

        result = self._request("PUT", endpoint, json_data=data)
        return cast(dict[str, Any], result)

    def delete_file(self, path: str, message: str, branch: str | None = None, sha: str | None = None) -> dict[str, Any]:
        """
        Delete a file from the repository.

        Args:
            path: File path in repository
            message: Commit message
            branch: Branch name (defaults to connection's branch)
            sha: File SHA (required)

        Returns:
            Commit information
        """
        if not sha:
            raise ValueError("SHA is required to delete a file")

        branch = branch or self.connection.branch
        endpoint = f"/repos/{self.connection.repository_full_name}/contents/{path}"

        data = {
            "message": message,
            "sha": sha,
            "branch": branch,
        }

        result = self._request("DELETE", endpoint, json_data=data)
        return cast(dict[str, Any], result)

    def get_commit_history(self, branch: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
        """
        Get commit history for a branch.

        Args:
            branch: Branch name (defaults to connection's branch)
            limit: Maximum number of commits to return

        Returns:
            List of commit information
        """
        branch = branch or self.connection.branch
        endpoint = f"/repos/{self.connection.repository_full_name}/commits"
        params = {
            "sha": branch,
            "per_page": min(limit, 100),  # GitHub API max is 100
        }
        result = self._request("GET", endpoint, params=params)
        return cast(list[dict[str, Any]], result)

    def get_commit(self, sha: str) -> dict[str, Any]:
        """
        Get specific commit information.

        Args:
            sha: Commit SHA

        Returns:
            Commit information
        """
        endpoint = f"/repos/{self.connection.repository_full_name}/commits/{sha}"
        result = self._request("GET", endpoint)
        return cast(dict[str, Any], result)

    def create_pull_request(
        self,
        title: str,
        body: str,
        head: str,
        base: str,
    ) -> dict[str, Any]:
        """
        Create a pull request.

        Args:
            title: PR title
            body: PR body/description
            head: Source branch
            base: Target branch

        Returns:
            Pull request information
        """
        endpoint = f"/repos/{self.connection.repository_full_name}/pulls"
        data = {
            "title": title,
            "body": body,
            "head": head,
            "base": base,
        }
        result = self._request("POST", endpoint, json_data=data)
        return cast(dict[str, Any], result)

    def list_repositories(self, type: str = "all") -> list[dict[str, Any]]:
        """
        List repositories accessible to the authenticated user.

        Args:
            type: Repository type (all, owner, member)

        Returns:
            List of repository information
        """
        endpoint = "/user/repos"
        params = {
            "type": type,
            "per_page": 100,
            "sort": "updated",
        }
        result = self._request("GET", endpoint, params=params)
        return cast(list[dict[str, Any]], result)
