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
    
    @staticmethod
    def get_and_fill_param(params: dict, key: str) -> str:
        """
        Gets a key's value from params. If the value is 'truthy', it's returned.
        Otherwise (if None, empty string, etc.), '.*' is returned.
        
        Args:
            params (dict): The dictionary to retrieve the value from.
            key (str): The key whose value is to be retrieved.

        Returns:
            str: The 'truthy' value associated with the key, or '.*' if the value
                 is 'falsy' or the key does not exist.
        """
        val = params.get(key)
        return val if val else '.*'