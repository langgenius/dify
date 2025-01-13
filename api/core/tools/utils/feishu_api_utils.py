import json
from typing import Any, Optional, cast

import httpx

from core.tools.errors import ToolProviderCredentialValidationError
from extensions.ext_redis import redis_client


def auth(credentials):
    app_id = credentials.get("app_id")
    app_secret = credentials.get("app_secret")
    if not app_id or not app_secret:
        raise ToolProviderCredentialValidationError("app_id and app_secret is required")
    try:
        assert FeishuRequest(app_id, app_secret).tenant_access_token is not None
    except Exception as e:
        raise ToolProviderCredentialValidationError(str(e))


def convert_add_records(json_str):
    try:
        data = json.loads(json_str)
        if not isinstance(data, list):
            raise ValueError("Parsed data must be a list")
        converted_data = [{"fields": json.dumps(item, ensure_ascii=False)} for item in data]
        return converted_data
    except json.JSONDecodeError:
        raise ValueError("The input string is not valid JSON")
    except Exception as e:
        raise ValueError(f"An error occurred while processing the data: {e}")


def convert_update_records(json_str):
    try:
        data = json.loads(json_str)
        if not isinstance(data, list):
            raise ValueError("Parsed data must be a list")

        converted_data = [
            {"fields": json.dumps(record["fields"], ensure_ascii=False), "record_id": record["record_id"]}
            for record in data
            if "fields" in record and "record_id" in record
        ]

        if len(converted_data) != len(data):
            raise ValueError("Each record must contain 'fields' and 'record_id'")

        return converted_data
    except json.JSONDecodeError:
        raise ValueError("The input string is not valid JSON")
    except Exception as e:
        raise ValueError(f"An error occurred while processing the data: {e}")


class FeishuRequest:
    API_BASE_URL = "https://lark-plugin-api.solutionsuite.cn/lark-plugin"

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
        self,
        url: str,
        method: str = "post",
        require_token: bool = True,
        payload: Optional[dict] = None,
        params: Optional[dict] = None,
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
        url = f"{self.API_BASE_URL}/access_token/get_tenant_access_token"
        payload = {"app_id": app_id, "app_secret": app_secret}
        res: dict = self._send_request(url, require_token=False, payload=payload)
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
        url = f"{self.API_BASE_URL}/document/create_document"
        payload = {
            "title": title,
            "content": content,
            "folder_token": folder_token,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def write_document(self, document_id: str, content: str, position: str = "end") -> dict:
        url = f"{self.API_BASE_URL}/document/write_document"
        payload = {"document_id": document_id, "content": content, "position": position}
        res: dict = self._send_request(url, payload=payload)
        return res

    def get_document_content(self, document_id: str, mode: str = "markdown", lang: str = "0") -> str:
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
            "mode": mode,
            "lang": lang,
        }
        url = f"{self.API_BASE_URL}/document/get_document_content"
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            return cast(str, res.get("data", {}).get("content"))
        return ""

    def list_document_blocks(
        self, document_id: str, page_token: str, user_id_type: str = "open_id", page_size: int = 500
    ) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/docs/docs/docx-v1/document/list
        """
        params = {
            "user_id_type": user_id_type,
            "document_id": document_id,
            "page_size": page_size,
            "page_token": page_token,
        }
        url = f"{self.API_BASE_URL}/document/list_document_blocks"
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def send_bot_message(self, receive_id_type: str, receive_id: str, msg_type: str, content: str) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/im-v1/message/create
        """
        url = f"{self.API_BASE_URL}/message/send_bot_message"
        params = {
            "receive_id_type": receive_id_type,
        }
        payload = {
            "receive_id": receive_id,
            "msg_type": msg_type,
            "content": content.strip('"').replace(r"\"", '"').replace(r"\\", "\\"),
        }
        res: dict = self._send_request(url, params=params, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def send_webhook_message(self, webhook: str, msg_type: str, content: str) -> dict:
        url = f"{self.API_BASE_URL}/message/send_webhook_message"
        payload = {
            "webhook": webhook,
            "msg_type": msg_type,
            "content": content.strip('"').replace(r"\"", '"').replace(r"\\", "\\"),
        }
        res: dict = self._send_request(url, require_token=False, payload=payload)
        return res

    def get_chat_messages(
        self,
        container_id: str,
        start_time: str,
        end_time: str,
        page_token: str,
        sort_type: str = "ByCreateTimeAsc",
        page_size: int = 20,
    ) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/im-v1/message/list
        """
        url = f"{self.API_BASE_URL}/message/get_chat_messages"
        params = {
            "container_id": container_id,
            "start_time": start_time,
            "end_time": end_time,
            "sort_type": sort_type,
            "page_token": page_token,
            "page_size": page_size,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def get_thread_messages(
        self, container_id: str, page_token: str, sort_type: str = "ByCreateTimeAsc", page_size: int = 20
    ) -> dict:
        """
        API url: https://open.larkoffice.com/document/server-docs/im-v1/message/list
        """
        url = f"{self.API_BASE_URL}/message/get_thread_messages"
        params = {
            "container_id": container_id,
            "sort_type": sort_type,
            "page_token": page_token,
            "page_size": page_size,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def create_task(self, summary: str, start_time: str, end_time: str, completed_time: str, description: str) -> dict:
        # 创建任务
        url = f"{self.API_BASE_URL}/task/create_task"
        payload = {
            "summary": summary,
            "start_time": start_time,
            "end_time": end_time,
            "completed_at": completed_time,
            "description": description,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def update_task(
        self, task_guid: str, summary: str, start_time: str, end_time: str, completed_time: str, description: str
    ) -> dict:
        # 更新任务
        url = f"{self.API_BASE_URL}/task/update_task"
        payload = {
            "task_guid": task_guid,
            "summary": summary,
            "start_time": start_time,
            "end_time": end_time,
            "completed_time": completed_time,
            "description": description,
        }
        res: dict = self._send_request(url, method="PATCH", payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def delete_task(self, task_guid: str) -> dict:
        # 删除任务
        url = f"{self.API_BASE_URL}/task/delete_task"
        payload = {
            "task_guid": task_guid,
        }
        res: dict = self._send_request(url, method="DELETE", payload=payload)
        return res

    def add_members(self, task_guid: str, member_phone_or_email: str, member_role: str) -> dict:
        # 删除任务
        url = f"{self.API_BASE_URL}/task/add_members"
        payload = {
            "task_guid": task_guid,
            "member_phone_or_email": member_phone_or_email,
            "member_role": member_role,
        }
        res: dict = self._send_request(url, payload=payload)
        return res

    def get_wiki_nodes(self, space_id: str, parent_node_token: str, page_token: str, page_size: int = 20) -> dict:
        # 获取知识库全部子节点列表
        url = f"{self.API_BASE_URL}/wiki/get_wiki_nodes"
        payload = {
            "space_id": space_id,
            "parent_node_token": parent_node_token,
            "page_token": page_token,
            "page_size": page_size,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def get_primary_calendar(self, user_id_type: str = "open_id") -> dict:
        url = f"{self.API_BASE_URL}/calendar/get_primary_calendar"
        params = {
            "user_id_type": user_id_type,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def create_event(
        self,
        summary: str,
        description: str,
        start_time: str,
        end_time: str,
        attendee_ability: str,
        need_notification: bool = True,
        auto_record: bool = False,
    ) -> dict:
        url = f"{self.API_BASE_URL}/calendar/create_event"
        payload = {
            "summary": summary,
            "description": description,
            "need_notification": need_notification,
            "start_time": start_time,
            "end_time": end_time,
            "auto_record": auto_record,
            "attendee_ability": attendee_ability,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def update_event(
        self,
        event_id: str,
        summary: str,
        description: str,
        need_notification: bool,
        start_time: str,
        end_time: str,
        auto_record: bool,
    ) -> dict:
        url = f"{self.API_BASE_URL}/calendar/update_event/{event_id}"
        payload: dict[str, Any] = {}
        if summary:
            payload["summary"] = summary
        if description:
            payload["description"] = description
        if start_time:
            payload["start_time"] = start_time
        if end_time:
            payload["end_time"] = end_time
        if need_notification:
            payload["need_notification"] = need_notification
        if auto_record:
            payload["auto_record"] = auto_record
        res: dict = self._send_request(url, method="PATCH", payload=payload)
        return res

    def delete_event(self, event_id: str, need_notification: bool = True) -> dict:
        url = f"{self.API_BASE_URL}/calendar/delete_event/{event_id}"
        params = {
            "need_notification": need_notification,
        }
        res: dict = self._send_request(url, method="DELETE", params=params)
        return res

    def list_events(self, start_time: str, end_time: str, page_token: str, page_size: int = 50) -> dict:
        url = f"{self.API_BASE_URL}/calendar/list_events"
        params = {
            "start_time": start_time,
            "end_time": end_time,
            "page_token": page_token,
            "page_size": page_size,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def search_events(
        self,
        query: str,
        start_time: str,
        end_time: str,
        page_token: str,
        user_id_type: str = "open_id",
        page_size: int = 20,
    ) -> dict:
        url = f"{self.API_BASE_URL}/calendar/search_events"
        payload = {
            "query": query,
            "start_time": start_time,
            "end_time": end_time,
            "page_token": page_token,
            "user_id_type": user_id_type,
            "page_size": page_size,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def add_event_attendees(self, event_id: str, attendee_phone_or_email: str, need_notification: bool = True) -> dict:
        # 参加日程参会人
        url = f"{self.API_BASE_URL}/calendar/add_event_attendees"
        payload = {
            "event_id": event_id,
            "attendee_phone_or_email": attendee_phone_or_email,
            "need_notification": need_notification,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def create_spreadsheet(
        self,
        title: str,
        folder_token: str,
    ) -> dict:
        # 创建电子表格
        url = f"{self.API_BASE_URL}/spreadsheet/create_spreadsheet"
        payload = {
            "title": title,
            "folder_token": folder_token,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def get_spreadsheet(
        self,
        spreadsheet_token: str,
        user_id_type: str = "open_id",
    ) -> dict:
        # 获取电子表格信息
        url = f"{self.API_BASE_URL}/spreadsheet/get_spreadsheet"
        params = {
            "spreadsheet_token": spreadsheet_token,
            "user_id_type": user_id_type,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def list_spreadsheet_sheets(
        self,
        spreadsheet_token: str,
    ) -> dict:
        # 列出电子表格的所有工作表
        url = f"{self.API_BASE_URL}/spreadsheet/list_spreadsheet_sheets"
        params = {
            "spreadsheet_token": spreadsheet_token,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def add_rows(
        self,
        spreadsheet_token: str,
        sheet_id: str,
        sheet_name: str,
        length: int,
        values: str,
    ) -> dict:
        # 增加行,在工作表最后添加
        url = f"{self.API_BASE_URL}/spreadsheet/add_rows"
        payload = {
            "spreadsheet_token": spreadsheet_token,
            "sheet_id": sheet_id,
            "sheet_name": sheet_name,
            "length": length,
            "values": values,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def add_cols(
        self,
        spreadsheet_token: str,
        sheet_id: str,
        sheet_name: str,
        length: int,
        values: str,
    ) -> dict:
        #  增加列,在工作表最后添加
        url = f"{self.API_BASE_URL}/spreadsheet/add_cols"
        payload = {
            "spreadsheet_token": spreadsheet_token,
            "sheet_id": sheet_id,
            "sheet_name": sheet_name,
            "length": length,
            "values": values,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def read_rows(
        self,
        spreadsheet_token: str,
        sheet_id: str,
        sheet_name: str,
        start_row: int,
        num_rows: int,
        user_id_type: str = "open_id",
    ) -> dict:
        # 读取工作表行数据
        url = f"{self.API_BASE_URL}/spreadsheet/read_rows"
        params = {
            "spreadsheet_token": spreadsheet_token,
            "sheet_id": sheet_id,
            "sheet_name": sheet_name,
            "start_row": start_row,
            "num_rows": num_rows,
            "user_id_type": user_id_type,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def read_cols(
        self,
        spreadsheet_token: str,
        sheet_id: str,
        sheet_name: str,
        start_col: int,
        num_cols: int,
        user_id_type: str = "open_id",
    ) -> dict:
        # 读取工作表列数据
        url = f"{self.API_BASE_URL}/spreadsheet/read_cols"
        params = {
            "spreadsheet_token": spreadsheet_token,
            "sheet_id": sheet_id,
            "sheet_name": sheet_name,
            "start_col": start_col,
            "num_cols": num_cols,
            "user_id_type": user_id_type,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def read_table(
        self,
        spreadsheet_token: str,
        sheet_id: str,
        sheet_name: str,
        num_range: str,
        query: str,
        user_id_type: str = "open_id",
    ) -> dict:
        # 自定义读取行列数据
        url = f"{self.API_BASE_URL}/spreadsheet/read_table"
        params = {
            "spreadsheet_token": spreadsheet_token,
            "sheet_id": sheet_id,
            "sheet_name": sheet_name,
            "range": num_range,
            "query": query,
            "user_id_type": user_id_type,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def create_base(
        self,
        name: str,
        folder_token: str,
    ) -> dict:
        # 创建多维表格
        url = f"{self.API_BASE_URL}/base/create_base"
        payload = {
            "name": name,
            "folder_token": folder_token,
        }
        res: dict = self._send_request(url, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def add_records(
        self,
        app_token: str,
        table_id: str,
        table_name: str,
        records: str,
        user_id_type: str = "open_id",
    ) -> dict:
        # 新增多条记录
        url = f"{self.API_BASE_URL}/base/add_records"
        params = {
            "app_token": app_token,
            "table_id": table_id,
            "table_name": table_name,
            "user_id_type": user_id_type,
        }
        payload = {
            "records": convert_add_records(records),
        }
        res: dict = self._send_request(url, params=params, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def update_records(
        self,
        app_token: str,
        table_id: str,
        table_name: str,
        records: str,
        user_id_type: str,
    ) -> dict:
        # 更新多条记录
        url = f"{self.API_BASE_URL}/base/update_records"
        params = {
            "app_token": app_token,
            "table_id": table_id,
            "table_name": table_name,
            "user_id_type": user_id_type,
        }
        payload = {
            "records": convert_update_records(records),
        }
        res: dict = self._send_request(url, params=params, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def delete_records(
        self,
        app_token: str,
        table_id: str,
        table_name: str,
        record_ids: str,
    ) -> dict:
        # 删除多条记录
        url = f"{self.API_BASE_URL}/base/delete_records"
        params = {
            "app_token": app_token,
            "table_id": table_id,
            "table_name": table_name,
        }
        if not record_ids:
            record_id_list = []
        else:
            try:
                record_id_list = json.loads(record_ids)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")
        payload = {
            "records": record_id_list,
        }
        res: dict = self._send_request(url, params=params, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def search_record(
        self,
        app_token: str,
        table_id: str,
        table_name: str,
        view_id: str,
        field_names: str,
        sort: str,
        filters: str,
        page_token: str,
        automatic_fields: bool = False,
        user_id_type: str = "open_id",
        page_size: int = 20,
    ) -> dict:
        # 查询记录，单次最多查询 500 行记录。
        url = f"{self.API_BASE_URL}/base/search_record"
        params = {
            "app_token": app_token,
            "table_id": table_id,
            "table_name": table_name,
            "user_id_type": user_id_type,
            "page_token": page_token,
            "page_size": page_size,
        }

        if not field_names:
            field_name_list = []
        else:
            try:
                field_name_list = json.loads(field_names)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")

        if not sort:
            sort_list = []
        else:
            try:
                sort_list = json.loads(sort)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")

        if not filters:
            filter_dict = {}
        else:
            try:
                filter_dict = json.loads(filters)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")

        payload: dict[str, Any] = {}

        if view_id:
            payload["view_id"] = view_id
        if field_names:
            payload["field_names"] = field_name_list
        if sort:
            payload["sort"] = sort_list
        if filters:
            payload["filter"] = filter_dict
        if automatic_fields:
            payload["automatic_fields"] = automatic_fields
        res: dict = self._send_request(url, params=params, payload=payload)

        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def get_base_info(
        self,
        app_token: str,
    ) -> dict:
        # 获取多维表格元数据
        url = f"{self.API_BASE_URL}/base/get_base_info"
        params = {
            "app_token": app_token,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def create_table(
        self,
        app_token: str,
        table_name: str,
        default_view_name: str,
        fields: str,
    ) -> dict:
        # 新增一个数据表
        url = f"{self.API_BASE_URL}/base/create_table"
        params = {
            "app_token": app_token,
        }
        if not fields:
            fields_list = []
        else:
            try:
                fields_list = json.loads(fields)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")
        payload = {
            "name": table_name,
            "fields": fields_list,
        }
        if default_view_name:
            payload["default_view_name"] = default_view_name
        res: dict = self._send_request(url, params=params, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def delete_tables(
        self,
        app_token: str,
        table_ids: str,
        table_names: str,
    ) -> dict:
        # 删除多个数据表
        url = f"{self.API_BASE_URL}/base/delete_tables"
        params = {
            "app_token": app_token,
        }
        if not table_ids:
            table_id_list = []
        else:
            try:
                table_id_list = json.loads(table_ids)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")

        if not table_names:
            table_name_list = []
        else:
            try:
                table_name_list = json.loads(table_names)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")

        payload = {
            "table_ids": table_id_list,
            "table_names": table_name_list,
        }

        res: dict = self._send_request(url, params=params, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def list_tables(
        self,
        app_token: str,
        page_token: str,
        page_size: int = 20,
    ) -> dict:
        # 列出多维表格下的全部数据表
        url = f"{self.API_BASE_URL}/base/list_tables"
        params = {
            "app_token": app_token,
            "page_token": page_token,
            "page_size": page_size,
        }
        res: dict = self._send_request(url, method="GET", params=params)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res

    def read_records(
        self,
        app_token: str,
        table_id: str,
        table_name: str,
        record_ids: str,
        user_id_type: str = "open_id",
    ) -> dict:
        url = f"{self.API_BASE_URL}/base/read_records"
        params = {
            "app_token": app_token,
            "table_id": table_id,
            "table_name": table_name,
        }
        if not record_ids:
            record_id_list = []
        else:
            try:
                record_id_list = json.loads(record_ids)
            except json.JSONDecodeError:
                raise ValueError("The input string is not valid JSON")
        payload = {
            "record_ids": record_id_list,
            "user_id_type": user_id_type,
        }
        res: dict = self._send_request(url, method="GET", params=params, payload=payload)
        if "data" in res:
            data: dict = res.get("data", {})
            return data
        return res
