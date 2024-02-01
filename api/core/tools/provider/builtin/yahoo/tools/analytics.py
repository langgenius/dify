from datetime import datetime
from typing import Any, Dict, List, Union

import pandas as pd
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from requests.exceptions import HTTPError, ReadTimeout
from yfinance import download


class YahooFinanceAnalyticsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any]) \
          -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        symbol = tool_parameters.get('symbol', '')
        if not symbol:
            return self.create_text_message('Please input symbol')
        
        time_range = [None, None]
        start_date = tool_parameters.get('start_date', '')
        if start_date:
            time_range[0] = start_date
        else:
            time_range[0] = '1800-01-01'

        end_date = tool_parameters.get('end_date', '')
        if end_date:
            time_range[1] = end_date
        else:
            time_range[1] = datetime.now().strftime('%Y-%m-%d')

        stock_data = download(symbol, start=time_range[0], end=time_range[1])
        max_segments = min(15, len(stock_data))
        rows_per_segment = len(stock_data) // (max_segments or 1)
        summary_data = []
        for i in range(max_segments):
            start_idx = i * rows_per_segment
            end_idx = (i + 1) * rows_per_segment if i < max_segments - 1 else len(stock_data)
            segment_data = stock_data.iloc[start_idx:end_idx]
            segment_summary = {
                'Start Date': segment_data.index[0],
                'End Date': segment_data.index[-1],
                'Average Close': segment_data['Close'].mean(),
                'Average Volume': segment_data['Volume'].mean(),
                'Average Open': segment_data['Open'].mean(),
                'Average High': segment_data['High'].mean(),
                'Average Low': segment_data['Low'].mean(),
                'Average Adj Close': segment_data['Adj Close'].mean(),
                'Max Close': segment_data['Close'].max(),
                'Min Close': segment_data['Close'].min(),
                'Max Volume': segment_data['Volume'].max(),
                'Min Volume': segment_data['Volume'].min(),
                'Max Open': segment_data['Open'].max(),
                'Min Open': segment_data['Open'].min(),
                'Max High': segment_data['High'].max(),
                'Min High': segment_data['High'].min(),
            }
            
            summary_data.append(segment_summary)

        summary_df = pd.DataFrame(summary_data)
        
        try:
            return self.create_text_message(str(summary_df.to_dict()))
        except (HTTPError, ReadTimeout):
            return self.create_text_message(f'There is a internet connection problem. Please try again later.')
    