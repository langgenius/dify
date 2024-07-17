from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from .feishu_api import FeishuRequest


class RecordTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get('app_id')
        app_secret = self.runtime.credentials.get('app_secret')
        client = FeishuRequest(app_id, app_secret)

        operations = tool_parameters.get('operations')
        app_token = tool_parameters.get('app_token')
        table_id = tool_parameters.get('table_id')

        fields = tool_parameters.get('fields')
        record_id = tool_parameters.get('record_id')

        page_size = tool_parameters.get('page_size', 20)
        page_token = tool_parameters.get('page_token', '')

        if operations == 'create':
            if not fields:
                raise ValueError('fields is required when create a record')
            res = client.create_table_record(app_token, table_id, fields)
        elif operations == 'read':
            if not record_id:
                raise ValueError('record id is required when get a record')
            res = client.get_table_record(app_token, table_id, record_id)
        elif operations == 'update':
            if not record_id:
                raise ValueError('record id is required when update a record')
            if not fields:
                raise ValueError('fields is required when update a record')
            res = client.update_table_record(app_token, table_id, record_id, fields)
        elif operations == 'delete':
            if not record_id:
                raise ValueError('record ids is required when delete a record')
            res = client.delete_table_record(app_token, table_id, record_id)
        elif operations == 'list':
            res = client.list_table_records(app_token, table_id, page_token, page_size)

        else:
            res = {'error': f'not support this {operations} operation'}
        return self.create_json_message(res)
