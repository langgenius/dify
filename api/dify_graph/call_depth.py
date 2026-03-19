"""Helpers for workflow recursion depth propagation.

The HTTP request node emits a reserved depth header pair on outbound requests,
and ``services.trigger.webhook_service`` validates that pair when a webhook is
received. The signature binds the propagated depth to the concrete HTTP method
and request path so a depth value captured for one endpoint cannot be replayed
verbatim against another path.
"""

import hashlib
import hmac


def build_workflow_call_depth_signature(*, secret_key: str, method: str, path: str, depth: str) -> str:
    """Build the stable HMAC payload for workflow call-depth propagation.

    Args:
        secret_key: Shared signing key used by both sender and receiver.
        method: Outbound or inbound HTTP method.
        path: Request path that the signature is bound to.
        depth: Workflow call depth value serialized as a string.

    Returns:
        Hex-encoded HMAC-SHA256 digest for the method/path/depth tuple.
    """
    payload = f"{method.upper()}:{path}:{depth}"
    return hmac.new(secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
