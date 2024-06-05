import io
from typing import Any, Union

import matplotlib.pyplot as plt

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class BarChartTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) \
          -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        data = tool_parameters.get('data', '')
        if not data:
            return self.create_text_message('Please input data')
        
        # Split data into groups
        data_groups = data.split(';')
        
        # Process each group of data
        for group in data_groups:
            group_data = group.split(',')
            if not all(i.replace('.', '', 1).isdigit() for i in group_data):
                return self.create_text_message('Invalid data format')
        
        # Extract x-axis labels
        axis_labels = tool_parameters.get('x_axis', '').split(';') if 'x_axis' in tool_parameters else None
        
        fig, ax = plt.subplots(figsize=(10, 8))
        
        for i, group in enumerate(data_groups):
            group_data = [int(point) if point.isdigit() else float(point) for point in group.split(',')]
            if axis_labels:
                ax.bar(axis_labels[i], group_data)
            else:
                ax.bar(range(1, len(group_data) + 1), group_data)
        
        if axis_labels:
            ax.set_xticks(range(len(axis_labels)))
            ax.set_xticklabels(axis_labels, rotation=45, ha='right')
        
        buf = io.BytesIO()
        fig.savefig(buf, format='png')
        buf.seek(0)
        plt.close(fig)
        
        return [
            self.create_text_message('The bar chart is saved as an image.'),
            self.create_blob_message(blob=buf.read(), meta={'mime_type': 'image/png'})
        ]
