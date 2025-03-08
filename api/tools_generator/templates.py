YAML_TEMPLATE = """identity:
  name: {tool_id}
  author: APO
  label:
    en_US: {en_label}
    zh_Hans: {zh_label}
description:
  human:
    en_US: {en_desc}
    zh_Hans: {zh_desc}
  llm: {llm_desc}
display:
  type: {disp_type}
  title: {disp_title}
  unit: "{disp_unit}"
parameters:
{params_block}
  - name: startTime
    type: number
    required: true
    label:
      en_US: startTime
      zh_Hans: startTime
      pt_BR: startTime
    human_description:
      en_US: Data query start time
      zh_Hans: 开始时间 (微秒)
      pt_BR: Data query start time
    llm_description: Data query start time
    form: llm
  - name: endTime
    type: number
    required: true
    label:
      en_US: endTime
      zh_Hans: endTime
      pt_BR: endTime
    human_description:
      en_US: Data query end time
      zh_Hans: 结束时间 (微秒)
      pt_BR: Data query end time
    llm_description: Data query start time
    form: llm
"""

PARAM_TEMPLATE = """  - name: {name}
    type: {type}
    required: {required}
    label:
      en_US: {label_en}
      zh_Hans: {label_zh}
    human_description:
      en_US: {desc_en}
      zh_Hans: {desc_zh}
    llm_description: {llm_desc}
    form: {form}"""

PYTHON_TEMPLATE = """import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class {class_name}(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
{param_lines}
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        params = {{
            'metricName': {metric_name!r},
            'params': {{
{param_dict}
            }},
            'startTime': start_time,
            'endTime': end_time,
            'step': APOUtils.get_step(start_time, end_time),
        }}
        resp = requests.post(dify_config.APO_BACKEND_URL + '/api/metric/query', json=params)
        list = resp.json()['result']
        list = json.dumps({{
            'type': 'metric',
            'display': True,
            'unit': list['unit'],
            'data': {{
                'timeseries': list['timeseries']
            }}
        }})
        yield self.create_text_message(list)"""