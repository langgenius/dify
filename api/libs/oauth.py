import logging
import sys
import urllib.parse
from dataclasses import dataclass
from typing import NotRequired

import httpx
from pydantic import TypeAdapter, ValidationError

if sys.version_info >= (3, 12):
    from typing import TypedDict
else:
    from typing_extensions import TypedDict

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
JsonObjectList = list[JsonObject]

JSON_OBJECT_ADAPTER = TypeAdapter(JsonObject)
JSON_OBJECT_LIST_ADAPTER = TypeAdapter(JsonObjectList)


class AccessTokenResponse(TypedDict, total=False):
    access_token: str


class GitHubEmailRecord(TypedDict, total=False):
    email: str
    primary: bool


class GitHubRawUserInfo(TypedDict):
    id: int | str
    login: str
    name: NotRequired[str | None]
    email: NotRequired[str | None]


class GoogleRawUserInfo(TypedDict):
    sub: str
    email: str


ACCESS_TOKEN_RESPONSE_ADAPTER = TypeAdapter(AccessTokenResponse)
GITHUB_RAW_USER_INFO_ADAPTER = TypeAdapter(GitHubRawUserInfo)
GITHUB_EMAIL_RECORDS_ADAPTER = TypeAdapter(list[GitHubEmailRecord])
GOOGLE_RAW_USER_INFO_ADAPTER = TypeAdapter(GoogleRawUserInfo)


@dataclass
class OAuthUserInfo:
    id: str
    name: str
    email: str


def _json_object(response: httpx.Response) -> JsonObject:
    return JSON_OBJECT_ADAPTER.validate_python(response.json())


def _json_list(response: httpx.Response) -> JsonObjectList:
    return JSON_OBJECT_LIST_ADAPTER.validate_python(response.json())


class OAuth:
    client_id: str
    client_secret: str
    redirect_uri: str

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def get_authorization_url(self, invite_token: str | None = None) -> str:
        raise NotImplementedError()

    def get_access_token(self, code: str) -> str:
        raise NotImplementedError()

    def get_raw_user_info(self, token: str) -> JsonObject:
        raise NotImplementedError()

    def get_user_info(self, token: str) -> OAuthUserInfo:
        raw_info = self.get_raw_user_info(token)
        return self._transform_user_info(raw_info)

    def _transform_user_info(self, raw_info: JsonObject) -> OAuthUserInfo:
        raise NotImplementedError()


class GitHubOAuth(OAuth):
    _AUTH_URL = "https://github.com/login/oauth/authorize"
    _TOKEN_URL = "https://github.com/login/oauth/access_token"
    _USER_INFO_URL = "https://api.github.com/user"
    _EMAIL_INFO_URL = "https://api.github.com/user/emails"

    def get_authorization_url(self, invite_token: str | None = None) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": "user:email",  # Request only basic user information
        }
        if invite_token:
            params["state"] = invite_token
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str) -> str:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
        }
        headers = {"Accept": "application/json"}
        response = httpx.post(self._TOKEN_URL, data=data, headers=headers)

        response_json = ACCESS_TOKEN_RESPONSE_ADAPTER.validate_python(_json_object(response))
        access_token = response_json.get("access_token")

        if not access_token:
            raise ValueError(f"Error in GitHub OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str) -> JsonObject:
        headers = {"Authorization": f"token {token}"}
        response = httpx.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        user_info = GITHUB_RAW_USER_INFO_ADAPTER.validate_python(_json_object(response))

        try:
            email_response = httpx.get(self._EMAIL_INFO_URL, headers=headers)
            email_response.raise_for_status()
            email_info = GITHUB_EMAIL_RECORDS_ADAPTER.validate_python(_json_list(email_response))
            primary_email = next((email for email in email_info if email.get("primary") is True), None)
        except (httpx.HTTPStatusError, ValidationError):
            logger.warning("Failed to retrieve email from GitHub /user/emails endpoint", exc_info=True)
            primary_email = None

        return {**user_info, "email": primary_email.get("email", "") if primary_email else ""}

    def _transform_user_info(self, raw_info: JsonObject) -> OAuthUserInfo:
        payload = GITHUB_RAW_USER_INFO_ADAPTER.validate_python(raw_info)
        email = payload.get("email")
        if not email:
            raise ValueError(
                'Dify currently not supports the "Keep my email addresses private" feature,'
                " please disable it and login again"
            )
        return OAuthUserInfo(id=str(payload["id"]), name=str(payload.get("name") or ""), email=email)


class GoogleOAuth(OAuth):
    _AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    _TOKEN_URL = "https://oauth2.googleapis.com/token"
    _USER_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

    def get_authorization_url(self, invite_token: str | None = None) -> str:
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": "openid email",
        }
        if invite_token:
            params["state"] = invite_token
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str) -> str:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
        }
        headers = {"Accept": "application/json"}
        response = httpx.post(self._TOKEN_URL, data=data, headers=headers)

        response_json = ACCESS_TOKEN_RESPONSE_ADAPTER.validate_python(_json_object(response))
        access_token = response_json.get("access_token")

        if not access_token:
            raise ValueError(f"Error in Google OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str) -> JsonObject:
        headers = {"Authorization": f"Bearer {token}"}
        response = httpx.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        return _json_object(response)

    def _transform_user_info(self, raw_info: JsonObject) -> OAuthUserInfo:
        payload = GOOGLE_RAW_USER_INFO_ADAPTER.validate_python(raw_info)
        return OAuthUserInfo(id=str(payload["sub"]), name="", email=payload["email"])
