import json
from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class ThresholdTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        metric = tool_parameters.get('metricData')
        metric_data = json.loads(metric)
        threshold = float(tool_parameters.get('threshold'))
        res = []
        for serie in metric_data['data']['timeseries']:
            tmpres = {
                "name": serie['legend'],
                "data": {},
            }
            for k, v in serie['chart']['chartData'].items():
                v = float(v)
                if v > threshold:
                    tmpres['data'][str(k)] = v
            res.append(tmpres)
        res = json.dumps({
            "type": 'llm',
            "display": False,
            "data": res
        })
        
        yield self.create_text_message(res)