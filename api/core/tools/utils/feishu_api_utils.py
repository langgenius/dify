import httpx

from extensions.ext_redis import redis_client


class FeishuRequest:
    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret

    @property
    def tenant_access_token(self):
        feishu_tenant_access_token = f"tools:{self.app_id}:feishu_tenant_access_token"
        if redis_client.exists(feishu_tenant_access_token):
            return redis_client.get(feishu_tenant_access_token).decode()
        res = self.get_tenant_access_token(self.app_id, self.app_secret)
        redis_client.setex(feishu_tenant_access_token, res.get("expire"), res.get("tenant_access_token"))
        return res.get("tenant_access_token")

    def _send_request(
        self, url: str, method: str = "post", require_token: bool = True, payload: dict = None, params: dict = None
    ):
        headers = {
            "Content-Type": "application/json",
            "user-agent": "Dify",
        }
        if require_token:
            headers["tenant-access-token"] = f"{self.tenant_access_token}"
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
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/access_token/get_tenant_access_token"
        payload = {"app_id": app_id, "app_secret": app_secret}
        res = self._send_request(url, require_token=False, payload=payload)
        return res

    def create_document(self, title: str, content: str, folder_token: str) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/docs/docs/docx-v1/document/create
        Example Response:
        {
            "data": {
                "title": "title",
                "url": "https://svi136aogf123.feishu.cn/docx/VWbvd4fEdoW0WSxaY1McQTz8n7d",
                "type": "docx",
                "token": "VWbvd4fEdoW0WSxaY1McQTz8n7d"
            },
            "log_id": "021721281231575fdbddc0200ff00060a9258ec0000103df61b5d",
            "code": 0,
            "msg": "创建飞书文档成功，请查看"
        }
        """
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/document/create_document"
        payload = {
            "title": title,
            "content": content,
            "folder_token": folder_token,
        }
        res = self._send_request(url, payload=payload)
        return res.get("data")

    def write_document(self, document_id: str, content: str, position: str = "start") -> dict:
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/document/write_document"
        payload = {"document_id": document_id, "content": content, "position": position}
        res = self._send_request(url, payload=payload)
        return res.get("data")

    def get_document_raw_content(self, document_id: str) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/docs/docs/docx-v1/document/raw_content
        Example Response:
        {
            "code": 0,
            "msg": "success",
            "data": {
                "content": "云文档\n多人实时协同，插入一切元素。不仅是在线文档，更是强大的创作和互动工具\n云文档：专为协作而生\n"
            }
        }
        """  # noqa: E501
        params = {
            "document_id": document_id,
        }
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/document/get_document_raw_content"
        res = self._send_request(url, method="get", params=params)
        return res.get("data").get("content")

    def list_document_block(self, document_id: str, page_token: str, page_size: int = 500) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/docs/docs/docx-v1/document/list
        """
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/document/list_document_block"
        params = {
            "document_id": document_id,
            "page_size": page_size,
            "page_token": page_token,
        }
        res = self._send_request(url, method="get", params=params)
        return res.get("data")

    def send_bot_message(self, receive_id_type: str, receive_id: str, msg_type: str, content: str) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/im-v1/message/create
        """
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/message/send_bot_message"
        params = {
            "receive_id_type": receive_id_type,
        }
        payload = {
            "receive_id": receive_id,
            "msg_type": msg_type,
            "content": content,
        }
        res = self._send_request(url, params=params, payload=payload)
        return res.get("data")

    def send_webhook_message(self, webhook: str, msg_type: str, content: str) -> dict:
        url = "https://lark-plugin-api.solutionsuite.cn/lark-plugin/message/send_webhook_message"
        payload = {
            "webhook": webhook,
            "msg_type": msg_type,
            "content": content,
        }
        res = self._send_request(url, require_token=False, payload=payload)
        return res
