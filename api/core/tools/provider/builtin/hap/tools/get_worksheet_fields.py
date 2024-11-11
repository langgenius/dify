import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GetWorksheetFieldsTool(BuiltinTool):
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
        elif not host.startswith(("http://", "https://")):
            return self.create_text_message("Invalid parameter Host Address")
        else:
            host = f"{host.removesuffix('/')}/api"

        url = f"{host}/v2/open/worksheet/getWorksheetInfo"
        headers = {"Content-Type": "application/json"}
        payload = {"appKey": appkey, "sign": sign, "worksheetId": worksheet_id}

        try:
            res = httpx.post(url, headers=headers, json=payload, timeout=60)
            res.raise_for_status()
            res_json = res.json()
            if res_json.get("error_code") != 1:
                return self.create_text_message(f"Failed to get the worksheet information. {res_json['error_msg']}")

            fields_json, fields_table = self.get_controls(res_json["data"]["controls"])
            result_type = tool_parameters.get("result_type", "table")
            return self.create_text_message(
                text=json.dumps(fields_json, ensure_ascii=False) if result_type == "json" else fields_table
            )
        except httpx.RequestError as e:
            return self.create_text_message(f"Failed to get the worksheet information, request error: {e}")
        except json.JSONDecodeError as e:
            return self.create_text_message(f"Failed to parse JSON response: {e}")
        except Exception as e:
            return self.create_text_message(f"Failed to get the worksheet information, unexpected error: {e}")

    def get_field_type_by_id(self, field_type_id: int) -> str:
        field_type_map = {
            2: "Text",
            3: "Text-Phone",
            4: "Text-Phone",
            5: "Text-Email",
            6: "Number",
            7: "Text",
            8: "Number",
            9: "Option-Single Choice",
            10: "Option-Multiple Choices",
            11: "Option-Single Choice",
            15: "Date",
            16: "Date",
            24: "Option-Region",
            25: "Text",
            26: "Option-Member",
            27: "Option-Department",
            28: "Number",
            29: "Option-Linked Record",
            30: "Unknown Type",
            31: "Number",
            32: "Text",
            33: "Text",
            35: "Option-Linked Record",
            36: "Number-Yes1/No0",
            37: "Number",
            38: "Date",
            40: "Location",
            41: "Text",
            46: "Time",
            48: "Option-Organizational Role",
            50: "Text",
            51: "Query Record",
        }
        return field_type_map.get(field_type_id, "")

    def get_controls(self, controls: list) -> dict:
        fields = []
        fields_list = ["|fieldId|fieldName|fieldType|fieldTypeId|description|options|", "|" + "---|" * 6]
        for control in controls:
            if control["type"] in self._get_ignore_types():
                continue
            field_type_id = control["type"]
            field_type = self.get_field_type_by_id(control["type"])
            if field_type_id == 30:
                source_type = control["sourceControl"]["type"]
                if source_type in self._get_ignore_types():
                    continue
                else:
                    field_type_id = source_type
                    field_type = self.get_field_type_by_id(source_type)
            field = {
                "id": control["controlId"],
                "name": control["controlName"],
                "type": field_type,
                "typeId": field_type_id,
                "description": control["remark"].replace("\n", " ").replace("\t", "  "),
                "options": self._extract_options(control),
            }
            fields.append(field)
            fields_list.append(
                f"|{field['id']}|{field['name']}|{field['type']}|{field['typeId']}|{field['description']}"
                f"|{field['options'] or ''}|"
            )

        fields.append(
            {
                "id": "ctime",
                "name": "Created Time",
                "type": self.get_field_type_by_id(16),
                "typeId": 16,
                "description": "",
                "options": [],
            }
        )
        fields_list.append("|ctime|Created Time|Date|16|||")
        return fields, "\n".join(fields_list)

    def _extract_options(self, control: dict) -> list:
        options = []
        if control["type"] in {9, 10, 11}:
            options.extend([{"key": opt["key"], "value": opt["value"]} for opt in control.get("options", [])])
        elif control["type"] in {28, 36}:
            itemnames = control["advancedSetting"].get("itemnames")
            if itemnames and itemnames.startswith("[{"):
                try:
                    options = json.loads(itemnames)
                except json.JSONDecodeError:
                    pass
        elif control["type"] == 30:
            source_type = control["sourceControl"]["type"]
            if source_type not in self._get_ignore_types():
                options.extend([{"key": opt["key"], "value": opt["value"]} for opt in control.get("options", [])])
        return options

    def _get_ignore_types(self):
        return {14, 21, 22, 34, 42, 43, 45, 47, 49, 10010}
