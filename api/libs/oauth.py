import hashlib
import time
import urllib.parse
from dataclasses import dataclass
from typing import Optional

import requests
import logging
import json
# Initialize logger for this module
logger = logging.getLogger(__name__)

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

    def get_authorization_url(self, invite_token: Optional[str] = None):
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
        response = requests.post(self._TOKEN_URL, data=data, headers=headers)

        response_json = response.json()
        access_token = response_json.get("access_token")

        if not access_token:
            raise ValueError(f"Error in GitHub OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str):
        headers = {"Authorization": f"token {token}"}
        response = requests.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        user_info = response.json()

        email_response = requests.get(self._EMAIL_INFO_URL, headers=headers)
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

    def get_authorization_url(self, invite_token: Optional[str] = None):
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
        response = requests.post(self._TOKEN_URL, data=data, headers=headers)

        response_json = response.json()
        access_token = response_json.get("access_token")

        if not access_token:
            raise ValueError(f"Error in Google OAuth: {response_json}")

        return access_token

    def get_raw_user_info(self, token: str):
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(self._USER_INFO_URL, headers=headers)
        response.raise_for_status()
        return response.json()

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        return OAuthUserInfo(id=str(raw_info["sub"]), name="", email=raw_info["email"])


class DigitalBaseOAuth(OAuth):
    _AUTH_URL = "http://1.92.71.188/gzt/login"      # 基座登录页地址
    _TOKEN_URL = "/oauth2/getTokenByCode"
    _USER_INFO_URL = "/oauth2/getUserInfoByToken"
    _REFRESH_URL = "/oauth2/refreshSessionByToken"

    def __init__(self, client_id: str, client_secret: str, redirect_uri: str, base_url: str):
        super().__init__(client_id, client_secret, redirect_uri)
        self.base_url = base_url
        self.app_key = client_id  # 数字基座中 AppKey 等同于 client_id
        self.app_secret = client_secret

    def get_authorization_url(self, invite_token: Optional[str] = None):
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
        }
        if invite_token:
            params["state"] = invite_token
        # return f"{self.base_url}/oauth2/authorize?{urllib.parse.urlencode(params)}"
        return f"{self._AUTH_URL}?{urllib.parse.urlencode(params)}"

    def _generate_headers(self, body: Optional[dict] = None) -> dict:
        timestamp = str(int(time.time() * 1000))
        body_length = len(json.dumps(body).encode('utf-8')) if body else 0
        content = f"{self.app_key}{timestamp}{body_length}"
        
        # 第一步：对AppKey + timestamp + bodyLength做sha256加密
        sign = hashlib.sha256(content.encode('utf-8')).hexdigest()
        
        # 第二步：对sign + AppSecret做md5加密
        open_sign = hashlib.md5(f"{sign}{self.app_secret}".encode('utf-8')).hexdigest()
        
        headers = {
            "openAppId": self.app_key,
            "openTimestamp": timestamp,
            "openSign": open_sign,
            "Content-Type": "application/json"
        }
        
        # 调试日志 - 中文输出
        logger.debug(f"数字基座认证请求头: {headers}")
        logger.debug(f"签名生成步骤 - 原始内容: {content}, SHA256签名: {sign}, 最终签名: {open_sign}")
        
        return headers

    def get_access_token(self, code: str):
        data = {"code": code}
        headers = self._generate_headers(data)
        
        response = requests.post(
            f"{self.base_url}{self._TOKEN_URL}",
            headers=headers,
            json=data
        )
        response_json = response.json()
        
        
        if response_json.get("retcode") != 0:
            raise ValueError(f"Error in DigitalBase OAuth: {response_json.get('errmsg')}")
        
        return response_json["data"]["accessToken"]

    def get_raw_user_info(self, token: str):
        data = {"accessToken": token}
        headers = {
            **self._generate_headers(data),
            "Authorization": f"Bearer {token}"
        }
        
        response = requests.post(
            f"{self.base_url}{self._USER_INFO_URL}",
            headers=headers,
            json={"accessToken": token}
        )
        response.raise_for_status()
        response_json = response.json()
        
        if response_json.get("retcode") != 0:
            raise ValueError(f"Error in DigitalBase OAuth: {response_json.get('errmsg')}")
        
        return response_json["data"]

    def _transform_user_info(self, raw_info: dict) -> OAuthUserInfo:
        return OAuthUserInfo(
            id=raw_info["eduID"],
            name=raw_info["name"],
            email=f"{raw_info['eduID']}@digitalbase.edu"  # 基座可能不提供email，使用eduID生成
        )
