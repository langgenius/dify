"""Cross a real owner's static input domain only for deliberate runtime negatives.

Use known parameter names with wrong values or missing arguments, never positive
fixtures. Unknown-keyword binding errors are not business-validator evidence.
"""

from collections.abc import Callable
from inspect import signature


def call_invalid[T](owner: Callable[..., T], /, *args: object, **kwargs: object) -> T:
    """Preserve values/identity and let the actual owner reject invalid inputs."""
    bound = signature(owner).bind_partial(*args, **kwargs)
    return owner(*bound.args, **bound.kwargs)
