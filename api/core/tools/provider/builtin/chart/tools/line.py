import io
from typing import Any, Union

import matplotlib.pyplot as plt

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class LinearChartTool(BuiltinTool):
    def _invoke(self, 
                user_id: str, 
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        data = tool_parameters.get('data', '')
        if not data:
            return self.create_text_message('Please input data')
        data = data.split(';')

        axis = tool_parameters.get('x_axis') or None
        if axis:
            axis = axis.split(';')
            if len(axis) != len(data):
                axis = None

        # if all data is int, convert to int
        if all(i.isdigit() for i in data):
            data = [int(i) for i in data]
        else:
            data = [float(i) for i in data]

        flg, ax = plt.subplots(figsize=(10, 8))

        if axis:
            axis = [label[:10] + '...' if len(label) > 10 else label for label in axis]
            ax.set_xticklabels(axis, rotation=45, ha='right')
            ax.plot(axis, data)
        else:
            ax.plot(data)

        buf = io.BytesIO()
        flg.savefig(buf, format='png')
        buf.seek(0)
        plt.close(flg)

        return [
            self.create_text_message('the linear chart is saved as an image.'),
            self.create_blob_message(blob=buf.read(),
                                    meta={'mime_type': 'image/png'})
        ]
    