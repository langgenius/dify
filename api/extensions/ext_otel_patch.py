"""
Patch for OpenTelemetry context detach method to handle None tokens gracefully.

This patch addresses the issue where OpenTelemetry's context.detach() method raises a TypeError
when called with a None token. The error occurs in the contextvars_context.py file where it tries
to call reset() on a None token.

Related GitHub issue: https://github.com/langgenius/dify/issues/18496

Error being fixed:
```
Traceback (most recent call last):
  File "opentelemetry/context/__init__.py", line 154, in detach
    _RUNTIME_CONTEXT.detach(token)
  File "opentelemetry/context/contextvars_context.py", line 50, in detach
    self._current_context.reset(token)  # type: ignore
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: expected an instance of Token, got None
```

Instead of modifying the third-party package directly, this patch monkey-patches the
context.detach method to gracefully handle None tokens.
"""

import logging
from functools import wraps

from opentelemetry import context

logger = logging.getLogger(__name__)

# Store the original detach method
original_detach = context.detach


# Create a patched version that handles None tokens
@wraps(original_detach)
def patched_detach(token):
    """
    A patched version of context.detach that handles None tokens gracefully.
    """
    if token is None:
        logger.debug("Attempted to detach a None token, skipping")
        return

    return original_detach(token)


def is_enabled():
    """
    Check if the extension is enabled.
    Always enable this patch to prevent errors even when OpenTelemetry is disabled.
    """
    return True


def init_app(app):
    """
    Initialize the OpenTelemetry context patch.
    """
    # Replace the original detach method with our patched version
    context.detach = patched_detach
    logger.info("OpenTelemetry context.detach patched to handle None tokens")
