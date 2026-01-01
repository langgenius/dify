import urllib.parse
from dataclasses import dataclass

import httpx


@dataclass
class OAuthUserInfo:
    id: str
    name: str
    email: str


class OAuth:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def get_authorization_url(
        self,
        state: str | None = None,
        invite_token: str | None = None,
        redirect_override: str | None = None,
    ):
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


class GitHubOAuth(OAuth):
    _AUTH_URL = "https://github.com/login/oauth/authorize"
    _TOKEN_URL = "https://github.com/login/oauth/access_token"
    _USER_INFO_URL = "https://api.github.com/user"
    _EMAIL_INFO_URL = "https://api.github.com/user/emails"

    def get_authorization_url(
        self,
        state: str | None = None,
        invite_token: str | None = None,
        redirect_override: str | None = None,
    ):
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_override or self.redirect_uri,
            "scope": "user:email",  # Request only basic user information
        }
        if state:
            params["state"] = state
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str):
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
        }
        headers = {"Accept": "application/json"}
        response = httpx.post(self._TOKEN_URL, data=data, headers=headers)

        response_json = response.json()
        access_token = response_json.get("access_token")

        if not access_token:
            raise ValueError(f"Error in GitHub OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str):
        headers = {"Authorization": f"token {token}"}
        response = httpx.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        user_info = response.json()

        email_response = httpx.get(self._EMAIL_INFO_URL, headers=headers)
        email_info = email_response.json()
        primary_email: dict = next(
            (email for email in email_info if email["primary"] == True), {})

        return {**user_info, "email": primary_email.get("email", "")}

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        email = raw_info.get("email")
        if not email:
            email = f"{raw_info['id']}+{raw_info['login']}@users.noreply.github.com"
        return OAuthUserInfo(id=str(raw_info["id"]), name=raw_info["name"], email=email)


class GoogleOAuth(OAuth):
    _AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    _TOKEN_URL = "https://oauth2.googleapis.com/token"
    _USER_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

    def get_authorization_url(
        self,
        state: str | None = None,
        invite_token: str | None = None,
        redirect_override: str | None = None,
    ):
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": redirect_override or self.redirect_uri,
            "scope": "openid email",
        }
        if state:
            params["state"] = state
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str):
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
        }
        headers = {"Accept": "application/json"}
        response = httpx.post(self._TOKEN_URL, data=data, headers=headers)

        response_json = response.json()
        access_token = response_json.get("access_token")

        if not access_token:
            raise ValueError(f"Error in Google OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str):
        headers = {"Authorization": f"Bearer {token}"}
        response = httpx.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        return response.json()

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        return OAuthUserInfo(id=str(raw_info["sub"]), name="", email=raw_info["email"])


class AceDataCloudOAuth(OAuth):
    """
    OAuth helper for the AceDataCloud auth service.
    It uses an auth code issued by auth.acedata.cloud, exchanges it for an access token,
    and then fetches the user profile to build a common OAuthUserInfo.
    """

    def __init__(self, base_url: str, redirect_uri: str, login_path: str = "/auth/login"):
        super().__init__("", "", redirect_uri)
        self.base_url = base_url.rstrip("/")
        self.login_path = login_path
        self._token_url = f"{self.base_url}/oauth2/v1/token"
        self._user_info_url = f"{self.base_url}/api/v1/users/me"

    def get_authorization_url(
        self,
        state: str | None = None,
        invite_token: str | None = None,
        redirect_override: str | None = None,
    ):
        redirect_uri = redirect_override or self.redirect_uri
        if state:
            redirect_uri = f"{redirect_uri}?{urllib.parse.urlencode({'state': state})}"
        params = {
            "redirect": redirect_uri,
        }
        return f"{self.base_url}{self.login_path}?{urllib.parse.urlencode(params)}"

    def exchange_code_for_token(self, code: str) -> dict:
        response = httpx.post(self._token_url, json={"code": code}, timeout=10)
        response.raise_for_status()
        return response.json()

    def get_access_token(self, code: str):
        response_json = self.exchange_code_for_token(code)
        access_token = response_json.get("access_token")
        if not access_token:
            raise ValueError(f"Error in AceDataCloud OAuth: {response_json}")
        return access_token

    def get_raw_user_info(self, token: str):
        headers = {"Authorization": f"Bearer {token}"}
        response = httpx.get(self._user_info_url, headers=headers, timeout=10)
        response.raise_for_status()
        return response.json()

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        user_id = raw_info.get("id") or raw_info.get("username")
        if not user_id:
            raise ValueError("Invalid user info: missing id")
        name = raw_info.get("username") or "AceDataCloud User"
        email = raw_info.get("email") or f"{user_id}@acedata.cloud"
        return OAuthUserInfo(id=str(user_id), name=name, email=email)
