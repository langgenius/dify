import json

import httpx

from extensions.ext_redis import redis_client


class FeishuRequest:
    def __init__(self, appid: str, app_secret: str):
        self.app_id = appid
        self.app_secret = app_secret

    @property
    def tenant_access_token(self):
        if redis_client.exists("feishu_tenant_access_token"):
            return redis_client.get("feishu_tenant_access_token").decode()
        res = self.get_tenant_access_token(self.app_id, self.app_secret)
        redis_client.setex("feishu_tenant_access_token", res.get("expire"), res.get("tenant_access_token"))
        return res.get("tenant_access_token")

    def _send_request(self, url: str, method: str = "post", require_token: bool = True, payload: dict = None,
                      params: dict = None):
        headers = {"Content-Type": "application/json"}
        if require_token:
            headers["Authorization"] = f"Bearer {self.tenant_access_token}"
        res = httpx.request(method=method, url=url, headers=headers, json=payload, params=params, timeout=30).json()
        if res.get("code") != 0:
            raise Exception(res)
        return res

    def get_tenant_access_token(self, app_id: str, app_secret: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
        Example Response:
        {
            "code": 0,
            "msg": "ok",
            "tenant_access_token": "t-caecc734c2e3328a62489fe0648c4b98779515d3",
            "expire": 7200
        }
        """
        url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        payload = {
            "app_id": app_id,
            "app_secret": app_secret
        }
        res = self._send_request(url, require_token=False, payload=payload)
        return res

    def create_base(self, base_name: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/create?appId=cli_a61e7f939f38900b
        Example Response:
        {
            "code": 0,
            "data": {
                "app": {
                    "app_token": "S404b*****e9PQsYDWYcNryFn0g",
                    "default_table_id": "tblxxxxxxxxoumSQ",
                    "folder_token": "fldbco*****CIMltVc",
                    "name": "一篇新的多维表格",
                    "url": "https://example.feishu.cn/base/S404b*****e9PQsYDWYcNryFn0g"
                }
            },
            "msg": "success"
        }
        """
        url = "https://open.feishu.cn/open-apis/bitable/v1/apps"
        payload = {"name": base_name}
        res = self._send_request(url, payload=payload)
        return res.get("data").get("app")

    def create_base_table(self, app_token: str, name: str, fields: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/create
        app_token: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bitable/notification#8121eebe
        Example Response:
        {
            "code": 0,
            "msg": "success",
            "data": {
                "table_id": "tblDBTWm6Es84d8c",
                "default_view_id": "vewUuKOz2R",
                "field_id_list": [
                    "fldhr2hBEA"
                ]
            }
        }
        """
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables"
        payload = {"table": {
            "name": name,
        }}
        if fields:
            payload["table"]["fields"] = json.loads(fields)
        res = self._send_request(url, payload=payload)
        return res.get("data")

    def list_base_tables(self, app_token: str, page_token: str = "", page_size: int = 20) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/list
        page_token is used for load next page"s data
        Example Response:
        {
            "code": 0,
            "msg": "success",
            "data": {
                "has_more": false,
                "page_token": "tblKz5D60T4JlfcT",
                "total": 1,
                "items": [
                    {
                        "table_id": "tblKz5D60T4JlfcT",
                        "revision": 1,
                        "name": "数据表1"
                    }
                ]
            }
        }
        """
        params = {
            "page_token": page_token,
            "page_size": page_size,
        }
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables"
        res = self._send_request(url, method="get", params=params)
        return res.get("data")

    def delete_base_table(self, app_token: str, table_id: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/delete
        Example Response:
        {
            "code": 0,
            "msg": "success",
            "data": {}
        }
        """
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}"
        res = self._send_request(url, method="delete")
        return res

    def create_table_record(self, app_token: str, table_id: str, fields: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create
        """
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records"
        payload = {
            "fields": json.loads(fields)
        }
        res = self._send_request(url, payload=payload)
        return res.get("data")

    def update_table_record(self, app_token: str, table_id: str, record_id: str,
                            fields: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update
        """
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
        payload = {
            "fields": json.loads(fields)
        }
        res = self._send_request(url, method="put", payload=payload)
        return res.get("data")

    def delete_table_record(self, app_token: str, table_id: str, record_id: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/delete
        """
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
        res = self._send_request(url, method="delete")
        return res.get("data")

    def get_table_record(self, app_token: str, table_id: str, record_id: str) -> dict:
        """
        API url: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/get
        """
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
        res = self._send_request(url, method="get")
        return res.get("data")

    def list_table_records(self, app_token: str, table_id: str, page_token: str = "",
                           page_size: int = 20) -> dict:
        """
        API url: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search
        """
        params = {
            "page_token": page_token,
            "page_size": page_size,
        }
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/search"
        res = self._send_request(url, params=params, payload={})
        return res.get("data")
