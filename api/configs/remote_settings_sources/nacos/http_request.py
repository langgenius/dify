import base64
import hashlib
import hmac
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)


class NacosHttpClient:
    def __init__(self):
        self.username = os.getenv("DIFY_ENV_NACOS_USERNAME")
        self.password = os.getenv("DIFY_ENV_NACOS_PASSWORD")
        self.ak = os.getenv("DIFY_ENV_NACOS_ACCESS_KEY")
        self.sk = os.getenv("DIFY_ENV_NACOS_SECRET_KEY")
        self.server = os.getenv("DIFY_ENV_NACOS_SERVER_ADDR", "localhost:8848")
        self.token: str | None = None
        self.token_ttl = 18000
        self.token_expire_time: float = 0

    def http_request(
        self, url: str, method: str = "GET", headers: dict[str, str] | None = None, params: dict[str, str] | None = None
    ) -> str:
        if headers is None:
            headers = {}
        if params is None:
            params = {}
        try:
            self._inject_auth_info(headers, params)
            response = httpx.request(method, url="http://" + self.server + url, headers=headers, params=params)
            response.raise_for_status()
            return response.text
        except httpx.RequestError as e:
            return f"Request to Nacos failed: {e}"

    def _inject_auth_info(self, headers: dict[str, str], params: dict[str, str], module: str = "config") -> None:
        headers.update({"User-Agent": "Nacos-Http-Client-In-Dify:v0.0.1"})

        if module == "login":
            return

        ts = str(int(time.time() * 1000))

        if self.ak and self.sk:
            sign_str = self.get_sign_str(params["group"], params["tenant"], ts)
            headers["Spas-AccessKey"] = self.ak
            headers["Spas-Signature"] = self.__do_sign(sign_str, self.sk)
            headers["timeStamp"] = ts
        if self.username and self.password:
            self.get_access_token(force_refresh=False)
            if self.token is not None:
                params["accessToken"] = self.token

    def __do_sign(self, sign_str: str, sk: str) -> str:
        return (
            base64.encodebytes(hmac.new(sk.encode(), sign_str.encode(), digestmod=hashlib.sha1).digest())
            .decode()
            .strip()
        )

    def get_sign_str(self, group: str, tenant: str, ts: str) -> str:
        sign_str = ""
        if tenant:
            sign_str = tenant + "+"
        if group:
            sign_str = sign_str + group + "+"
        sign_str += ts  # Directly concatenate ts without conditional checks, because the nacos auth header forced it.
        return sign_str

    def get_access_token(self, force_refresh: bool = False) -> str | None:
        current_time = time.time()
        if self.token and not force_refresh and self.token_expire_time > current_time:
            return self.token

        params = {"username": self.username, "password": self.password}
        url = "http://" + self.server + "/nacos/v1/auth/login"
        try:
            resp = httpx.request("POST", url, headers=None, params=params)
            resp.raise_for_status()
            response_data = resp.json()
            self.token = response_data.get("accessToken")
            self.token_ttl = response_data.get("tokenTtl", 18000)
            self.token_expire_time = current_time + self.token_ttl - 10
            return self.token
        except Exception:
            logger.exception("[get-access-token] exception occur")
            raise
