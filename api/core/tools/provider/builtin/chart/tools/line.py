from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
import matplotlib.pyplot as plt
import io

from typing import Any, Dict, List, Union

class LinearChartTool(BuiltinTool):
    def _invoke(self, 
                user_id: str, 
               tool_paramters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        data = tool_paramters.get('data', '')
        if not data:
            return self.create_text_message('Please input data')
        data = data.split(',')
        data = [float(i) for i in data]

        flg, ax = plt.subplots()
        ax.plot([1, 2, 3, 4], [1, 4, 2, 3])

        buf = io.BytesIO()
        flg.savefig(buf, format='png')
        buf.seek(0)

        return self.create_blob_message(blob=buf.read(),
                                        meta={
                                            'type': 'image/png'
                                        })
    