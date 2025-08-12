import json
from unittest.mock import Mock, patch

import requests
from flask import Flask

from controllers.console.github import GithubStarApi


class TestGithubStarApi:
    def setup_method(self):
        self.app = Flask(__name__)
        self.api = GithubStarApi()
        self.fallback_count = 98570

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_get_from_cache_success(self, mock_requests, mock_redis):
        cached_data = {"stargazers_count": 99000, "updated_at": 1234567890}
        mock_redis.get.return_value = json.dumps(cached_data)
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": 99000}
        mock_requests.assert_not_called()

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_get_from_github_api_success(self, mock_requests, mock_redis):
        mock_redis.get.return_value = None
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"stargazers_count": 100000}
        mock_requests.return_value = mock_response
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": 100000}
        mock_redis.setex.assert_called_once()

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_get_github_api_failure_returns_fallback(self, mock_requests, mock_redis):
        mock_redis.get.return_value = None
        mock_requests.side_effect = requests.exceptions.RequestException("API Error")
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": self.fallback_count}

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_get_github_api_bad_status_returns_fallback(self, mock_requests, mock_redis):
        mock_redis.get.return_value = None
        
        mock_response = Mock()
        mock_response.status_code = 403
        mock_requests.return_value = mock_response
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": self.fallback_count}

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_cache_json_decode_error_falls_through(self, mock_requests, mock_redis):
        mock_redis.get.return_value = "invalid_json"
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"stargazers_count": 101000}
        mock_requests.return_value = mock_response
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": 101000}

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_cache_setex_failure_still_returns_data(self, mock_requests, mock_redis):
        mock_redis.get.return_value = None
        mock_redis.setex.side_effect = Exception("Redis error")
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"stargazers_count": 102000}
        mock_requests.return_value = mock_response
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": 102000}

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_timeout_configuration(self, mock_requests, mock_redis):
        mock_redis.get.return_value = None
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"stargazers_count": 103000}
        mock_requests.return_value = mock_response
        
        with self.app.test_request_context():
            self.api.get()
        
        mock_requests.assert_called_with(
            "https://api.github.com/repos/langgenius/dify",
            timeout=10,
            headers={"User-Agent": "Dify-App"}
        )

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_github_api_missing_stargazers_count_uses_fallback(self, mock_requests, mock_redis):
        mock_redis.get.return_value = None
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"name": "dify", "description": "some description"}
        mock_requests.return_value = mock_response
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": self.fallback_count}

    @patch('controllers.console.github.redis_client')
    @patch('controllers.console.github.requests.get')
    def test_cache_contains_invalid_stargazers_count_key(self, mock_requests, mock_redis):
        cached_data = {"updated_at": 1234567890}  # missing stargazers_count
        mock_redis.get.return_value = json.dumps(cached_data)
        
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"stargazers_count": 104000}
        mock_requests.return_value = mock_response
        
        with self.app.test_request_context():
            result = self.api.get()
        
        assert result == {"stargazers_count": 104000}