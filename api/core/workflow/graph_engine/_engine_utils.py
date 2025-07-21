import time


def get_timestamp() -> float:
    """Retrieve a timestamp as a float point numer representing the number of seconds
    since the Unix epoch.

    This function is primarily used to measure the execution time of the workflow engine.
    Since workflow execution may be paused and resumed on a different machine,
    `time.perf_counter` cannot be used as it is inconsistent across machines.

    To address this, the function uses the wall clock as the time source.
    However, it assumes that the clocks of all servers are properly synchronized.
    """
    return round(time.time())
