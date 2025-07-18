class APOUtils:
    
    @classmethod
    def get_step(self, start_time, end_time):
        time_diff = end_time - start_time

        SECOND = 1000000  # microseconds
        MINUTE = 60 * SECOND
        HOUR = 60 * MINUTE

        step = SECOND  # default step is 1 second

        if time_diff <= 15 * MINUTE:
            step = 30 * SECOND
        elif time_diff <= 30 * MINUTE:
            step = 1 * MINUTE
        elif time_diff <= 1 * HOUR:
            step = 2 * MINUTE
        elif time_diff <= 1.5 * HOUR:
            step = 3 * MINUTE
        elif time_diff <= 3 * HOUR:
            step = 6 * MINUTE
        elif time_diff <= 6 * HOUR:
            step = 12 * MINUTE
        elif time_diff <= 12 * HOUR:
            step = 24 * MINUTE
        elif time_diff <= 15 * HOUR:
            step = 30 * MINUTE
        elif time_diff <= 30 * HOUR:
            step = 1 * HOUR
        else:
            step = ((time_diff + 30 * SECOND - 1) // (30 * SECOND)) * SECOND

        return step
    
    @staticmethod
    def vec_from_duration(duration_ns: int) -> str:
        one_minute_ns = 60 * 10**9
        if duration_ns >= one_minute_ns:
            minutes = duration_ns // one_minute_ns
            return f"{minutes}m"
        else:
            seconds = duration_ns // 10**9
            return f"{seconds}s"
    
    @staticmethod
    def get_step_with_unit(start_time, end_time) -> str:
        time_diff = end_time - start_time

        SECOND = 1000000
        MINUTE = 60 * SECOND
        HOUR = 60 * MINUTE
        step = '5m'
        if time_diff <= 15 * MINUTE:
            step = '30s'
        elif time_diff <= 30 * MINUTE:
            step = '1m'
        elif time_diff <= 1 * HOUR:
            step = '2m'
        elif time_diff <= 1.5 * HOUR:
            step = '3m'
        elif time_diff <= 3 * HOUR:
            step = '6m'
        elif time_diff <= 6 * HOUR:
            step = '12m'
        elif time_diff <= 12 * HOUR:
            step = '24m'
        elif time_diff <= 15 * HOUR:
            step = '30m'
        elif time_diff <= 30 * HOUR:
            step = '1h'
        else:
            step_hours = (time_diff + HOUR - 1) // HOUR
            step = f"{step_hours}h"

        return step
    
    def get_and_build_metric_params(param: dict, key_map: dict) -> dict:
        """
        从param字典中提取指定的key，并根据key_map映射构建新的参数字典
        只有当param中key的value不为空（不是None、空字符串、空列表等）时，才会添加到返回值中

        Args:
            param: 源参数字典
            key_map: 键映射字典，格式为 {源key: 目标key}

        Returns:
            dict: 构建后的参数字典，只包含非空值

        Examples:
            >>> param = {'name': 'test', 'age': 25, 'email': '', 'phone': None}
            >>> key_map = {'name': 'username', 'age': 'user_age', 'email': 'user_email', 'phone': 'user_phone'}
            >>> get_and_build_params(param, key_map)
            {'username': 'test', 'user_age': 25}
        """
        result = {}

        for source_key, target_key in key_map.items():
            value = param.get(source_key)

            if value is not None and value != '':
                if hasattr(value, '__len__') and len(value) == 0:
                    continue
                result[target_key] = value

        return result
