
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