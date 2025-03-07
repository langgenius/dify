import json
import numpy as np
from scipy import stats
from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class TrendTool(BuiltinTool):
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
        # threshold = float(tool_parameters.get('threshold'))
        res = "true"
        for serie in metric_data['data']['timeseries']:
            # for k, v in serie['chart']['chartData'].items():
            #     v = float(v)
            #     if v > threshold:
            #         tmpres['data'][str(k)] = v
            tmpres = self.analyze_kv_trend(serie['chart']['chartData'], window_size=5)
            if tmpres.get('trend', "") != "" and tmpres.get('trend', "") != '波动':
                res = "false"
        
        yield self.create_text_message(res)
    
    def analyze_kv_trend(self, data_dict, window_size=5, threshold=0.05): 
    
        # 提取值序列
        values = np.array(list(data_dict.values()))
    
        # 检查数据有效性
        if len(values) < window_size:
            return {"error": "数据长度不足"}
    
        # 计算整体趋势（使用线性回归）
        x = np.arange(len(values))
        slope, intercept, r_value, p_value, std_err = stats.linregress(x, values)
    
        # 计算滑动窗口的局部变化
        local_trends = []
        for i in range(len(values) - window_size + 1):
            window = values[i:i + window_size]
            window_x = np.arange(window_size)
            window_slope = stats.linregress(window_x, window)[0]
            local_trends.append(window_slope)
    
        # 分析结果
        result = {
            "overall_slope": slope,  # 整体斜率
            "p_value": p_value,     # 统计显著性
            "std_dev": np.std(values), # 数据标准差
            "local_trend_variability": np.std(local_trends), # 局部趋势变化的标准差
            "data_points": len(values), # 数据点数量
        }
    
        # 判断趋势类型
        if p_value < threshold and slope > 0:
            if result["local_trend_variability"] < abs(slope) * 0.5:
                result["trend"] = "持续升高"
                result["description"] = "数据呈现显著的持续上升趋势"
            else:
                result["trend"] = "波动上升"
                result["description"] = "数据整体上升但存在一定波动"
        elif p_value < threshold and slope < 0:
            result["trend"] = "持续下降"
            result["description"] = "数据呈现显著的持续下降趋势"
        else:
            result["trend"] = "波动"
            result["description"] = "数据呈现波动状态，无显著趋势"
    
        return result