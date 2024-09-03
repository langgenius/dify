import os
from typing import Any

import httpx
from yarl import URL


class AListRequest:
    def __init__(self, url: str, username: str, password: str):
        self.url = url
        self.username = username
        self.password = password

    @property
    def api_token(self):
        res = self.get_api_token(self.username, self.password)
        if res.get("data") is None:
            raise Exception(res)
        return res["data"].get("token")

    def _send_request(
        self,
        url: str,
        method: str = "post",
        require_token: bool = True,
        content: str = None,
        payload: Any = None,
        headers: dict = {},
        params: dict = None,
    ):
        headers.update(
            {
                "Content-Type": "application/json",
                "user-agent": "Dify",
            }
        )
        if require_token:
            headers["Authorization"] = f"{self.api_token}"
        res = httpx.request(
            method=method, url=url, headers=headers, content=content, json=payload, params=params, timeout=30
        )
        res.raise_for_status()
        res = res.json()
        if res.get("code") != 200:
            raise Exception(res)
        return res

    def get_api_token(self, username: str, password: str) -> dict:
        """
        API url: https://alist.nn.ci/guide/api/auth.html
        Example Response:
        {
            "code": 200,
            "message": "success",
            "data": {
                "token": "<string>"
            }
        }
        """
        payload = {"username": username, "password": password}
        api_url = str(URL(self.url) / "api" / "auth" / "login")
        res = self._send_request(api_url, require_token=False, payload=payload)
        return res

    def write_file(self, file_path: str, content: str) -> dict:
        """
        API url: https://alist.nn.ci/guide/api/fs.html
        """
        headers = {
            "File-Path": file_path,
            "As-Task": "true",
        }
        api_url = str(URL(self.url) / "api" / "fs" / "put")
        res = self._send_request(api_url, content=content, method="put", headers=headers)
        return res

    def remove_file(self, file_path: str) -> dict:
        """
        API url: https://alist.nn.ci/guide/api/fs.html
        """
        dir, path = os.path.split(file_path)
        payload = {"names": [path], "dir": dir}
        api_url = str(URL(self.url) / "api" / "fs" / "remove")
        res = self._send_request(api_url, payload=payload)
        return res

    def list_file(self, path: str, page: int = 1, page_size: int = 500) -> dict:
        """
        API url: https://alist.nn.ci/guide/api/fs.html
        """
        payload = {"path": path, "page": page, "per_page": page_size, "password": "", "refresh": True}
        api_url = str(URL(self.url) / "api" / "fs" / "list")
        res = self._send_request(api_url, payload=payload)
        return res.get("data")
