"""Email OAuth implementation with dependency injection for better testability"""

import base64
import urllib.parse
from dataclasses import dataclass
from typing import Optional, Union

from .oauth_http_client import OAuthHTTPClient, OAuthHTTPClientProtocol


@dataclass
class OAuthUserInfo:
    id: str
    name: str
    email: str


class EmailOAuth:
    """Base OAuth class with dependency injection"""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        http_client: Optional[OAuthHTTPClientProtocol] = None,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.http_client = http_client or OAuthHTTPClient()

    def get_authorization_url(self):
        raise NotImplementedError()

    def get_access_token(self, code: str):
        raise NotImplementedError()

    def get_raw_user_info(self, token: str):
        raise NotImplementedError()

    def get_user_info(self, token: str) -> OAuthUserInfo:
        raw_info = self.get_raw_user_info(token)
        return self._transform_user_info(raw_info)

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        raise NotImplementedError()


class MicrosoftEmailOAuth(EmailOAuth):
    """Microsoft OAuth 2.0 implementation with dependency injection

    References:
    - Microsoft identity platform OAuth 2.0: https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow
    - Microsoft Graph API permissions: https://learn.microsoft.com/en-us/graph/permissions-reference
    - OAuth 2.0 client credentials flow: https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-client-creds-grant-flow
    - SMTP OAuth 2.0 authentication: https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth
    """

    _AUTH_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
    _TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    _USER_INFO_URL = "https://graph.microsoft.com/v1.0/me"

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        tenant_id: str = "common",
        http_client: Optional[OAuthHTTPClientProtocol] = None,
    ):
        super().__init__(client_id, client_secret, redirect_uri, http_client)
        self.tenant_id = tenant_id

    def get_authorization_url(self, invite_token: Optional[str] = None) -> str:
        """Generate OAuth authorization URL"""
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": "https://outlook.office.com/SMTP.Send offline_access",
            "response_mode": "query",
        }
        if invite_token:
            params["state"] = invite_token

        auth_url = self._AUTH_URL.format(tenant=self.tenant_id)
        return f"{auth_url}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str) -> dict[str, Union[str, int]]:
        """Get access token using authorization code flow"""
        data: dict[str, Union[str, int]] = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
            "scope": "https://outlook.office.com/SMTP.Send offline_access",
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        token_url = self._TOKEN_URL.format(tenant=self.tenant_id)
        response = self.http_client.post(token_url, data=data, headers=headers)

        if response["status_code"] != 200:
            raise ValueError(f"Error in Microsoft OAuth: {response['json']}")

        json_response = response["json"]
        if isinstance(json_response, dict):
            return json_response
        raise ValueError("Unexpected response format")

    def get_access_token_client_credentials(
        self, scope: str = "https://outlook.office365.com/.default"
    ) -> dict[str, Union[str, int]]:
        """Get access token using client credentials flow (for service accounts)"""
        data: dict[str, Union[str, int]] = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "client_credentials",
            "scope": scope,
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        token_url = self._TOKEN_URL.format(tenant=self.tenant_id)
        response = self.http_client.post(token_url, data=data, headers=headers)

        if response["status_code"] != 200:
            raise ValueError(f"Error in Microsoft OAuth Client Credentials: {response['json']}")

        json_response = response["json"]
        if isinstance(json_response, dict):
            return json_response
        raise ValueError("Unexpected response format")

    def refresh_access_token(self, refresh_token: str) -> dict[str, Union[str, int]]:
        """Refresh access token using refresh token"""
        data: dict[str, Union[str, int]] = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
            "scope": "https://outlook.office.com/SMTP.Send offline_access",
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        token_url = self._TOKEN_URL.format(tenant=self.tenant_id)
        response = self.http_client.post(token_url, data=data, headers=headers)

        if response["status_code"] != 200:
            raise ValueError(f"Error refreshing Microsoft OAuth token: {response['json']}")

        json_response = response["json"]
        if isinstance(json_response, dict):
            return json_response
        raise ValueError("Unexpected response format")

    def get_raw_user_info(self, token: str) -> dict[str, Union[str, int, dict, list]]:
        """Get user info from Microsoft Graph API"""
        headers = {"Authorization": f"Bearer {token}"}
        return self.http_client.get(self._USER_INFO_URL, headers=headers)

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        """Transform raw user info to OAuthUserInfo"""
        return OAuthUserInfo(
            id=str(raw_info["id"]),
            name=raw_info.get("displayName", ""),
            email=raw_info.get("mail", raw_info.get("userPrincipalName", "")),
        )

    @staticmethod
    def create_sasl_xoauth2_string(username: str, access_token: str) -> str:
        """Create SASL XOAUTH2 authentication string for SMTP"""
        auth_string = f"user={username}\x01auth=Bearer {access_token}\x01\x01"
        return base64.b64encode(auth_string.encode()).decode()
