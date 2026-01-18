"""
Unit tests for GitHubAPIClient.

This test suite covers:
- Repository operations
- Branch management
- File operations
- Commit history
"""

from unittest.mock import MagicMock, patch

import pytest

from models.github_connection import GitHubConnection
from services.github.github_api_client import GitHubAPIClient


class TestGitHubAPIClient:
    """Test suite for GitHubAPIClient."""

    @pytest.fixture
    def mock_connection(self):
        """Create a mock GitHubConnection."""
        connection = MagicMock(spec=GitHubConnection)
        connection.repository_owner = "testowner"
        connection.repository_name = "testrepo"
        connection.branch = "main"
        connection.get_decrypted_access_token.return_value = "test-token-123"
        return connection

    @pytest.fixture
    def client(self, mock_connection):
        """Create GitHubAPIClient instance."""
        return GitHubAPIClient(mock_connection)

    def test_get_repository_info(self, client, mock_connection):
        """Test getting repository information."""
        expected_response = {
            "id": 12345,
            "name": "testrepo",
            "full_name": "testowner/testrepo",
            "private": False,
        }

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.get_repository_info()

            assert result == expected_response
            mock_request.assert_called_once()
            call_args = mock_request.call_args
            assert call_args[0][0] == "GET"
            assert "/repos/testowner/testrepo" in call_args[0][1]

    def test_list_branches(self, client, mock_connection):
        """Test listing branches."""
        expected_response = [
            {"name": "main", "commit": {"sha": "abc123"}},
            {"name": "develop", "commit": {"sha": "def456"}},
        ]

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.list_branches()

            assert result == expected_response
            assert len(result) == 2
            assert result[0]["name"] == "main"

    def test_get_branch(self, client, mock_connection):
        """Test getting specific branch information."""
        branch_name = "develop"
        expected_response = {
            "name": "develop",
            "commit": {"sha": "def456", "url": "https://api.github.com/repos/testowner/testrepo/commits/def456"},
        }

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.get_branch(branch_name)

            assert result == expected_response
            assert result["name"] == branch_name

    def test_create_branch(self, client, mock_connection):
        """Test creating a new branch."""
        branch_name = "feature/new-feature"
        from_branch = "main"

        branch_info = {"name": "main", "commit": {"sha": "abc123"}}
        create_response = {"ref": f"refs/heads/{branch_name}", "sha": "abc123"}

        with patch("services.github.github_api_client.make_request") as mock_request:
            # First call: get source branch
            # Second call: create new branch
            mock_request.side_effect = [branch_info, create_response]

            result = client.create_branch(branch_name, from_branch)

            assert result == create_response
            assert mock_request.call_count == 2

    def test_get_file_content(self, client, mock_connection):
        """Test getting file content."""
        path = "workflows/app-123/workflow.yaml"
        branch = "main"
        expected_response = {
            "name": "workflow.yaml",
            "path": path,
            "sha": "file-sha-123",
            "content": "d29ya2Zsb3c6CiAgbm9kZXM6IFtdCg==",  # base64 encoded
        }

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.get_file_content(path, branch)

            assert result == expected_response
            call_args = mock_request.call_args
            assert path in call_args[0][1]
            assert call_args[1]["params"]["ref"] == branch

    def test_create_or_update_file(self, client, mock_connection):
        """Test creating or updating a file."""
        path = "workflows/app-123/workflow.yaml"
        content = "d29ya2Zsb3c6CiAgbm9kZXM6IFtdCg=="  # base64 encoded
        message = "Add workflow file"
        branch = "main"

        expected_response = {
            "content": {"sha": "new-file-sha"},
            "commit": {"sha": "commit-sha-123"},
        }

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.create_or_update_file(path, content, message, branch)

            assert result == expected_response
            call_args = mock_request.call_args
            assert call_args[0][0] == "PUT"
            assert path in call_args[0][1]
            assert call_args[1]["json_data"]["message"] == message
            assert call_args[1]["json_data"]["content"] == content

    def test_get_commit_history(self, client, mock_connection):
        """Test getting commit history."""
        branch = "main"
        limit = 10

        expected_response = [
            {"sha": "abc123", "commit": {"message": "First commit"}},
            {"sha": "def456", "commit": {"message": "Second commit"}},
        ]

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.get_commit_history(branch, limit)

            assert result == expected_response
            call_args = mock_request.call_args
            assert call_args[1]["params"]["sha"] == branch
            assert call_args[1]["params"]["per_page"] == min(limit, 100)

    def test_get_commit(self, client, mock_connection):
        """Test getting specific commit information."""
        sha = "abc123"
        expected_response = {
            "sha": sha,
            "commit": {
                "message": "Test commit",
                "author": {"name": "Test User", "email": "test@example.com"},
            },
        }

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.get_commit(sha)

            assert result == expected_response
            assert result["sha"] == sha

    def test_create_pull_request(self, client, mock_connection):
        """Test creating a pull request."""
        title = "Test PR"
        body = "This is a test pull request"
        head = "feature/new-feature"
        base = "main"

        expected_response = {
            "id": 12345,
            "number": 1,
            "title": title,
            "state": "open",
        }

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.create_pull_request(title, body, head, base)

            assert result == expected_response
            call_args = mock_request.call_args
            assert call_args[0][0] == "POST"
            assert call_args[1]["json_data"]["title"] == title
            assert call_args[1]["json_data"]["head"] == head
            assert call_args[1]["json_data"]["base"] == base

    def test_list_repositories(self, client, mock_connection):
        """Test listing repositories."""
        expected_response = [
            {"id": 1, "name": "repo1", "full_name": "testowner/repo1"},
            {"id": 2, "name": "repo2", "full_name": "testowner/repo2"},
        ]

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_request.return_value = expected_response

            result = client.list_repositories()

            assert result == expected_response
            assert len(result) == 2

    def test_api_error_handling(self, client, mock_connection):
        """Test API error handling."""
        import httpx

        with patch("services.github.github_api_client.make_request") as mock_request:
            mock_response = MagicMock()
            mock_response.status_code = 404
            mock_response.text = "Not Found"
            mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
                "Not Found", request=MagicMock(), response=mock_response
            )

            mock_request.return_value = mock_response

            with pytest.raises(ValueError, match="GitHub API error"):
                client.get_repository_info()
