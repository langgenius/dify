import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GetWorksheetPivotDataTool(BuiltinTool):

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        
        appkey = tool_parameters.get('appkey', '')
        if not appkey:
            return self.create_text_message('Invalid parameter App Key')
        sign = tool_parameters.get('sign', '')
        if not sign:
            return self.create_text_message('Invalid parameter Sign')
        worksheet_id = tool_parameters.get('worksheet_id', '')
        if not worksheet_id:
            return self.create_text_message('Invalid parameter Worksheet ID')
        x_column_fields = tool_parameters.get('x_column_fields', '')
        if not x_column_fields or not x_column_fields.startswith('['):
            return self.create_text_message('Invalid parameter Column Fields')
        y_row_fields = tool_parameters.get('y_row_fields', '')
        if y_row_fields and not y_row_fields.strip().startswith('['):
            return self.create_text_message('Invalid parameter Row Fields')
        elif not y_row_fields:
            y_row_fields = '[]'
        value_fields = tool_parameters.get('value_fields', '')
        if not value_fields or not value_fields.strip().startswith('['):
            return self.create_text_message('Invalid parameter Value Fields')
        
        host = tool_parameters.get('host', '')
        if not host:
            host = 'https://api.mingdao.com'
        elif not host.startswith(("http://", "https://")):
            return self.create_text_message('Invalid parameter Host Address')
        else:
            host = f"{host[:-1] if host.endswith('/') else host}/api"

        url = f"{host}/report/getPivotData"
        headers = {'Content-Type': 'application/json'}
        payload = {"appKey": appkey, "sign": sign, "worksheetId": worksheet_id, "options": {"showTotal": True}}

        try:
            x_column_fields = json.loads(x_column_fields)
            payload['columns'] = x_column_fields
            y_row_fields = json.loads(y_row_fields)
            if y_row_fields: payload['rows'] = y_row_fields
            value_fields = json.loads(value_fields)
            payload['values'] = value_fields
            sort_fields = tool_parameters.get('sort_fields', '')
            if not sort_fields: sort_fields = '[]'
            sort_fields = json.loads(sort_fields)
            if sort_fields: payload['options']['sort'] = sort_fields
            res = httpx.post(url, headers=headers, json=payload, timeout=60)
            res.raise_for_status()
            res_json = res.json()
            if res_json.get('status') != 1:
                return self.create_text_message(f"Failed to get the worksheet pivot data. {res_json['msg']}")
            
            pivot_json = self.generate_pivot_json(res_json['data'])
            pivot_table = self.generate_pivot_table(res_json['data'])
            result_type = tool_parameters.get('result_type', '')
            text = pivot_table if result_type == 'table' else json.dumps(pivot_json, ensure_ascii=False)
            return self.create_text_message(text)
        except httpx.RequestError as e:
            return self.create_text_message(f"Failed to get the worksheet pivot data, request error: {e}")
        except json.JSONDecodeError as e:
            return self.create_text_message(f"Failed to parse JSON response: {e}")
        except Exception as e:
            return self.create_text_message(f"Failed to get the worksheet pivot data, unexpected error: {e}")

    def generate_pivot_table(self, data: dict[str, Any]) -> str:
        columns = data['metadata']['columns']
        rows = data['metadata']['rows']
        values = data['metadata']['values']

        rows_data = data['data']

        header = ([row['displayName'] for row in rows] if rows else []) + [column['displayName'] for column in columns] + [value['displayName'] for value in values]
        line = (['---'] * len(rows) if rows else []) + ['---'] * len(columns) + ['--:'] * len(values)

        table = [header, line]
        for row in rows_data:
            row_data = [self.replace_pipe(row['rows'][r['controlId']]) for r in rows] if rows else []
            row_data.extend([self.replace_pipe(row['columns'][column['controlId']]) for column in columns])
            row_data.extend([self.replace_pipe(str(row['values'][value['controlId']])) for value in values])
            table.append(row_data)

        return '\n'.join([('|'+'|'.join(row) +'|') for row in table])
    
    def replace_pipe(self, text: str) -> str:
        return text.replace('|', '▏').replace('\n', ' ')
    
    def generate_pivot_json(self, data: dict[str, Any]) -> dict:
        fields = {
            "x-axis": [
                {"fieldId": column["controlId"], "fieldName": column["displayName"]}
                for column in data["metadata"]["columns"]
            ],
            "y-axis": [
                {"fieldId": row["controlId"], "fieldName": row["displayName"]}
                for row in data["metadata"]["rows"]
            ] if data["metadata"]["rows"] else [],
            "values": [
                {"fieldId": value["controlId"], "fieldName": value["displayName"]}
                for value in data["metadata"]["values"]
            ]
        }
        # fields = ([
        #     {"fieldId": row["controlId"], "fieldName": row["displayName"]}
        #     for row in data["metadata"]["rows"]
        # ] if data["metadata"]["rows"] else []) + [
        #     {"fieldId": column["controlId"], "fieldName": column["displayName"]}
        #     for column in data["metadata"]["columns"]
        # ] + [
        #     {"fieldId": value["controlId"], "fieldName": value["displayName"]}
        #     for value in data["metadata"]["values"]
        # ]
        rows = []
        for row in data["data"]:
            row_data = row["rows"] if row["rows"] else {}
            row_data.update(row["columns"])
            row_data.update(row["values"])
            rows.append(row_data)
        return {"fields": fields, "rows": rows, "summary": data["metadata"]["totalRow"]}