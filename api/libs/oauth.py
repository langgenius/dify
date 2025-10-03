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


class GitHubOAuth(OAuth):
    _AUTH_URL = "https://github.com/login/oauth/authorize"
    _TOKEN_URL = "https://github.com/login/oauth/access_token"
    _USER_INFO_URL = "https://api.github.com/user"
    _EMAIL_INFO_URL = "https://api.github.com/user/emails"

    def get_authorization_url(self, invite_token: str | None = None):
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": "user:email",  # Request only basic user information
        }
        if invite_token:
            params["state"] = invite_token
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
        primary_email: dict = next((email for email in email_info if email["primary"] == True), {})

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

    def get_authorization_url(self, invite_token: str | None = None):
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": "openid email",
        }
        if invite_token:
            params["state"] = invite_token
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


class DingTalkOAuth(OAuth):
    """DingTalk OAuth implementation"""

    _AUTH_URL = "https://login.dingtalk.com/oauth2/auth"
    _TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/userAccessToken"
    _USER_INFO_URL = "https://api.dingtalk.com/v1.0/contact/users/me"

    def get_authorization_url(self, invite_token: str | None = None):
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": "openid",
            "response_type": "code",
            "prompt": "consent",
        }
        if invite_token:
            params["state"] = invite_token
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def get_access_token(self, code: str):
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        data = {
            "clientId": self.client_id,
            "clientSecret": self.client_secret,
            "code": code,
            "grantType": "authorization_code",
        }
        response = httpx.post(self._TOKEN_URL, json=data, headers=headers)
        response_json = response.json()
        access_token = response_json.get("accessToken")

        if not access_token:
            raise ValueError(f"Error in DingTalk OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str):
        headers = {"x-acs-dingtalk-access-token": token}
        response = httpx.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        return response.json()

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        user_id = raw_info.get("unionId", "")
        if not user_id:  
            raise ValueError("`unionId` not found in DingTalk user info response.")  
        name = raw_info.get("nick", "")
        email = raw_info.get("email", f"{user_id}@dingtalk.local")
        return OAuthUserInfo(id=user_id, name=name, email=email)


class MicrosoftOAuth(OAuth):
    """Microsoft OAuth implementation"""

    _AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    _TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    _USER_INFO_URL = "https://graph.microsoft.com/v1.0/me"

    def get_authorization_url(self, invite_token: str | None = None):
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "user.read",
            "response_mode": "query",
        }
        if invite_token:
            params["state"] = invite_token
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
            raise ValueError(f"Error in Microsoft OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str):
        headers = {"Authorization": f"Bearer {token}"}
        response = httpx.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        return response.json()

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        user_id = str(raw_info.get("id", ""))
        name = raw_info.get("displayName", "")
        email = raw_info.get("mail") or raw_info.get("userPrincipalName", f"{user_id}@microsoft.local")
        return OAuthUserInfo(id=user_id, name=name, email=email)


class CanvasOAuth(OAuth):
    """Canvas LMS OAuth implementation"""

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str, install_url: str):
        super().__init__(client_id, client_secret, redirect_uri)
        self.install_url = install_url.rstrip("/")
        self._AUTH_URL = f"{self.install_url}/login/oauth2/auth"
        self._TOKEN_URL = f"{self.install_url}/login/oauth2/token"
        self._user_cache = None  # Cache user info from token response

    def get_authorization_url(self, invite_token: str | None = None):
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
        }
        if invite_token:
            params["state"] = invite_token
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
        
        # Canvas returns user info in the token response
        # Example: {"access_token": "...", "user": {"id": 42, "name": "Jimi Hendrix"}, ...}
        user_info = response_json.get("user", {})
        if user_info:
            self._user_cache = user_info
        
        access_token = response_json.get("access_token")
        if not access_token:
            raise ValueError(f"Error in Canvas OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str):
        # Canvas returns user info in the token response, which we cached
        if self._user_cache:
            return self._user_cache
        
        raise ValueError("Canvas user info not available from token response.")

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        # Canvas uses 'id' as the primary identifier
        user_id = str(raw_info.get("id", ""))
        name = raw_info.get("name", "")
        email = raw_info.get("email", f"{user_id}@canvas.local")
        return OAuthUserInfo(id=user_id, name=name, email=email)