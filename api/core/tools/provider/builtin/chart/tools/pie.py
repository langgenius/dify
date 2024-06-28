import io
from typing import Any, Union

import matplotlib.pyplot as plt

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class PieChartTool(BuiltinTool):
    def _invoke(self, 
                user_id: str, 
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        data = tool_parameters.get('data', '')
        if not data:
            return self.create_text_message('Please input data')
        data = data.split(';')
        categories = tool_parameters.get('categories') or None

        # if all data is int, convert to int
        if all(i.isdigit() for i in data):
            data = [int(i) for i in data]
        else:
            data = [float(i) for i in data]

        flg, ax = plt.subplots()

        if categories:
            categories = categories.split(';')
            if len(categories) != len(data):
                categories = None

        if categories:
            ax.pie(data, labels=categories)
        else:
            ax.pie(data)

        buf = io.BytesIO()
        flg.savefig(buf, format='png')
        buf.seek(0)
        plt.close(flg)

        return [
            self.create_text_message('the pie chart is saved as an image.'),
            self.create_blob_message(blob=buf.read(),
                                    meta={'mime_type': 'image/png'})
        ]