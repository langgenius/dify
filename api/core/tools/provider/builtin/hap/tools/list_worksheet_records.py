import json
import re
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class ListWorksheetRecordsTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        appkey = tool_parameters.get("appkey", "")
        if not appkey:
            return self.create_text_message("Invalid parameter App Key")

        sign = tool_parameters.get("sign", "")
        if not sign:
            return self.create_text_message("Invalid parameter Sign")

        worksheet_id = tool_parameters.get("worksheet_id", "")
        if not worksheet_id:
            return self.create_text_message("Invalid parameter Worksheet ID")

        host = tool_parameters.get("host", "")
        if not host:
            host = "https://api.mingdao.com"
        elif not (host.startswith("http://") or host.startswith("https://")):
            return self.create_text_message("Invalid parameter Host Address")
        else:
            host = f"{host.removesuffix('/')}/api"

        url_fields = f"{host}/v2/open/worksheet/getWorksheetInfo"
        headers = {"Content-Type": "application/json"}
        payload = {"appKey": appkey, "sign": sign, "worksheetId": worksheet_id}

        field_ids = tool_parameters.get("field_ids", "")

        try:
            res = httpx.post(url_fields, headers=headers, json=payload, timeout=30)
            res_json = res.json()
            if res.is_success:
                if res_json["error_code"] != 1:
                    return self.create_text_message(
                        "Failed to get the worksheet information. {}".format(res_json["error_msg"])
                    )
                else:
                    worksheet_name = res_json["data"]["name"]
                    fields, schema, table_header = self.get_schema(res_json["data"]["controls"], field_ids)
            else:
                return self.create_text_message(
                    f"Failed to get the worksheet information, status code: {res.status_code}, response: {res.text}"
                )
        except Exception as e:
            return self.create_text_message(
                "Failed to get the worksheet information, something went wrong: {}".format(e)
            )

        if field_ids:
            payload["controls"] = [v.strip() for v in field_ids.split(",")] if field_ids else []
        filters = tool_parameters.get("filters", "")
        if filters:
            payload["filters"] = json.loads(filters)
        sort_id = tool_parameters.get("sort_id", "")
        sort_is_asc = tool_parameters.get("sort_is_asc", False)
        if sort_id:
            payload["sortId"] = sort_id
            payload["isAsc"] = sort_is_asc
        limit = tool_parameters.get("limit", 50)
        payload["pageSize"] = limit
        page_index = tool_parameters.get("page_index", 1)
        payload["pageIndex"] = page_index
        payload["useControlId"] = True
        payload["listType"] = 1

        url = f"{host}/v2/open/worksheet/getFilterRows"
        try:
            res = httpx.post(url, headers=headers, json=payload, timeout=90)
            res_json = res.json()
            if res.is_success:
                if res_json["error_code"] != 1:
                    return self.create_text_message("Failed to get the records. {}".format(res_json["error_msg"]))
                else:
                    result = {
                        "fields": fields,
                        "rows": [],
                        "total": res_json.get("data", {}).get("total"),
                        "payload": {
                            key: payload[key]
                            for key in [
                                "worksheetId",
                                "controls",
                                "filters",
                                "sortId",
                                "isAsc",
                                "pageSize",
                                "pageIndex",
                            ]
                            if key in payload
                        },
                    }
                    rows = res_json.get("data", {}).get("rows", [])
                    result_type = tool_parameters.get("result_type", "")
                    if not result_type:
                        result_type = "table"
                    if result_type == "json":
                        for row in rows:
                            result["rows"].append(self.get_row_field_value(row, schema))
                        return self.create_text_message(json.dumps(result, ensure_ascii=False))
                    else:
                        result_text = f'Found {result["total"]} rows in worksheet "{worksheet_name}".'
                        if result["total"] > 0:
                            result_text += (
                                f" The following are {min(limit, result['total'])}"
                                f" pieces of data presented in a table format:\n\n{table_header}"
                            )
                            for row in rows:
                                result_values = []
                                for f in fields:
                                    result_values.append(
                                        self.handle_value_type(row[f["fieldId"]], schema[f["fieldId"]])
                                    )
                                result_text += "\n|" + "|".join(result_values) + "|"
                        return self.create_text_message(result_text)
            else:
                return self.create_text_message(
                    f"Failed to get the records, status code: {res.status_code}, response: {res.text}"
                )
        except Exception as e:
            return self.create_text_message("Failed to get the records, something went wrong: {}".format(e))

    def get_row_field_value(self, row: dict, schema: dict):
        row_value = {"rowid": row["rowid"]}
        for field in schema:
            row_value[field] = self.handle_value_type(row[field], schema[field])
        return row_value

    def get_schema(self, controls: list, fieldids: str):
        allow_fields = {v.strip() for v in fieldids.split(",")} if fieldids else set()
        fields = []
        schema = {}
        field_names = []
        for control in controls:
            control_type_id = self.get_real_type_id(control)
            if (control_type_id in self._get_ignore_types()) or (
                allow_fields and control["controlId"] not in allow_fields
            ):
                continue
            else:
                fields.append({"fieldId": control["controlId"], "fieldName": control["controlName"]})
                schema[control["controlId"]] = {"typeId": control_type_id, "options": self.set_option(control)}
                field_names.append(control["controlName"])
        if not allow_fields or ("ctime" in allow_fields):
            fields.append({"fieldId": "ctime", "fieldName": "Created Time"})
            schema["ctime"] = {"typeId": 16, "options": {}}
            field_names.append("Created Time")
        fields.append({"fieldId": "rowid", "fieldName": "Record Row ID"})
        schema["rowid"] = {"typeId": 2, "options": {}}
        field_names.append("Record Row ID")
        return fields, schema, "|" + "|".join(field_names) + "|\n|" + "---|" * len(field_names)

    def get_real_type_id(self, control: dict) -> int:
        return control["sourceControlType"] if control["type"] == 30 else control["type"]

    def set_option(self, control: dict) -> dict:
        options = {}
        if control.get("options"):
            options = {option["key"]: option["value"] for option in control["options"]}
        elif control.get("advancedSetting", {}).get("itemnames"):
            try:
                itemnames = json.loads(control["advancedSetting"]["itemnames"])
                options = {item["key"]: item["value"] for item in itemnames}
            except json.JSONDecodeError:
                pass
        return options

    def _get_ignore_types(self):
        return {14, 21, 22, 34, 42, 43, 45, 47, 49, 10010}

    def handle_value_type(self, value, field):
        type_id = field.get("typeId")
        if type_id == 10:
            value = value if isinstance(value, str) else "、".join(value)
        elif type_id in {28, 36}:
            value = field.get("options", {}).get(value, value)
        elif type_id in {26, 27, 48, 14}:
            value = self.process_value(value)
        elif type_id in {35, 29}:
            value = self.parse_cascade_or_associated(field, value)
        elif type_id == 40:
            value = self.parse_location(value)
        return self.rich_text_to_plain_text(value) if value else ""

    def process_value(self, value):
        if isinstance(value, str):
            if value.startswith('[{"accountId"'):
                value = json.loads(value)
                value = ", ".join([item["fullname"] for item in value])
            elif value.startswith('[{"departmentId"'):
                value = json.loads(value)
                value = "、".join([item["departmentName"] for item in value])
            elif value.startswith('[{"organizeId"'):
                value = json.loads(value)
                value = "、".join([item["organizeName"] for item in value])
            elif value.startswith('[{"file_id"') or value == "[]":
                value = ""
        elif hasattr(value, "accountId"):
            value = value["fullname"]
        return value

    def parse_cascade_or_associated(self, field, value):
        if (field["typeId"] == 35 and value.startswith("[")) or (field["typeId"] == 29 and value.startswith("[{")):
            value = json.loads(value)
            value = value[0]["name"] if len(value) > 0 else ""
        else:
            value = ""
        return value

    def parse_location(self, value):
        if len(value) > 10:
            parsed_value = json.loads(value)
            value = parsed_value.get("address", "")
        else:
            value = ""
        return value

    def rich_text_to_plain_text(self, rich_text):
        text = re.sub(r"<[^>]+>", "", rich_text) if "<" in rich_text else rich_text
        return text.replace("|", "▏").replace("\n", " ")
