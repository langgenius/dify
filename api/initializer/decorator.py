from typing import Callable, List, Tuple

_initializers: List[Tuple[Callable, int]] = []

def initializer(priority: int = 10) -> Callable:
    def decorator(func: Callable) -> Callable:
        _initializers.append((func, priority))
        return func
    return decorator
