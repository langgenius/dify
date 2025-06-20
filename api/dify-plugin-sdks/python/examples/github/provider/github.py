import secrets
import urllib.parse
from collections.abc import Mapping
from typing import Any

import requests
from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError
from werkzeug import Request


class GithubProvider(ToolProvider):
    _AUTH_URL = "https://github.com/login/oauth/authorize"
    _TOKEN_URL = "https://github.com/login/oauth/access_token"
    _API_USER_URL = "https://api.github.com/user"

    def _oauth_get_authorization_url(self, system_credentials: Mapping[str, Any]) -> str:
        """
        Generate the authorization URL for the Github OAuth.
        """
        state = secrets.token_urlsafe(16)
        params = {
            "client_id": system_credentials["client_id"],
            "redirect_uri": system_credentials["redirect_uri"],
            "scope": system_credentials.get("scope", "read:user"),
            "state": state,
            # Optionally: allow_signup, login, etc.
        }
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def _oauth_get_credentials(self, system_credentials: Mapping[str, Any], request: Request) -> Mapping[str, Any]:
        """
        Exchange code for access_token.
        """
        code = request.args.get("code")
        state = request.args.get("state")
        if not code:
            raise ValueError("No code provided")
        # Optionally: validate state here

        data = {
            "client_id": system_credentials["client_id"],
            "client_secret": system_credentials["client_secret"],
            "code": code,
            "redirect_uri": system_credentials["redirect_uri"],
        }
        headers = {"Accept": "application/json"}
        response = requests.post(self._TOKEN_URL, data=data, headers=headers, timeout=10)
        response_json = response.json()
        access_token = response_json.get("access_token")
        if not access_token:
            raise ValueError(f"Error in GitHub OAuth: {response_json}")
        return {"access_token": access_token}

    def _validate_credentials(self, credentials: dict) -> None:
        try:
            if "access_token" not in credentials or not credentials.get("access_token"):
                raise ToolProviderCredentialValidationError("GitHub API Access Token is required.")
            headers = {
                "Authorization": f"Bearer {credentials['access_token']}",
                "Accept": "application/vnd.github+json",
            }
            response = requests.get(self._API_USER_URL, headers=headers, timeout=10)
            if response.status_code != 200:
                raise ToolProviderCredentialValidationError(response.json().get("message"))
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e)) 