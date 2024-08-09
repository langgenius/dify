from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from .feishu_api import FeishuRequest


class TableTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get('app_id')
        app_secret = self.runtime.credentials.get('app_secret')
        client = FeishuRequest(app_id, app_secret)

        operations = tool_parameters.get('operations')
        app_token = tool_parameters.get('app_token')
        name = tool_parameters.get('name')
        fields = tool_parameters.get('fields', '')
        page_size = tool_parameters.get('page_size', 20)
        page_token = tool_parameters.get('page_token', '')
        table_id = tool_parameters.get('table_id')

        if operations == 'create':
            if not name:
                raise ValueError('name is required when create table')
            res = client.create_base_table(app_token, name, fields)
        elif operations == 'list':
            res = client.list_base_tables(app_token, page_token, page_size)
        elif operations == 'delete':
            if not table_id:
                raise ValueError('table id is required when delete tables')
            res = client.delete_base_table(app_token, table_id)
        else:
            res = {'error': f'not support this {operations} operation'}
        return self.create_json_message(res)
