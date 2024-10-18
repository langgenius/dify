"""
语雀客户端
"""

__author__ = "佐井"
__created__ = "2024-06-01 09:45:20"

from typing import Any

import requests


class AliYuqueTool:
    # yuque service url
    server_url = "https://www.yuque.com"

    @staticmethod
    def auth(token):
        session = requests.Session()
        session.headers.update({"Accept": "application/json", "X-Auth-Token": token})
        login = session.request("GET", AliYuqueTool.server_url + "/api/v2/user")
        login.raise_for_status()
        resp = login.json()
        return resp

    def request(self, method: str, token, tool_parameters: dict[str, Any], path: str) -> str:
        if not token:
            raise Exception("token is required")
        session = requests.Session()
        session.headers.update({"accept": "application/json", "X-Auth-Token": token})
        new_params = {**tool_parameters}
        # 找出需要替换的变量
        replacements = {k: v for k, v in new_params.items() if f"{{{k}}}" in path}

        # 替换 path 中的变量
        for key, value in replacements.items():
            path = path.replace(f"{{{key}}}", str(value))
            del new_params[key]  # 从 kwargs 中删除已经替换的变量
        # 请求接口
        if method.upper() in {"POST", "PUT"}:
            session.headers.update(
                {
                    "Content-Type": "application/json",
                }
            )
            response = session.request(method.upper(), self.server_url + path, json=new_params)
        else:
            response = session.request(method, self.server_url + path, params=new_params)
        response.raise_for_status()
        return response.text
