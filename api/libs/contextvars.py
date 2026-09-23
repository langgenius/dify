from collections.abc import Generator
from contextlib import ExitStack, contextmanager
from contextvars import Context


@contextmanager
def use_contextvars(context_vars: Context | None) -> Generator[None, None, None]:
    """Apply captured bindings and restore the caller's values after cleanup."""
    with ExitStack() as stack:
        if context_vars is not None:
            for var, value in context_vars.items():
                stack.callback(var.reset, var.set(value))
        yield
