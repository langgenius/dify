"""Recover legacy plugin-client failures at the Agent LLM gateway boundary only.

The clients keep their ValueError contract for other callers. Gateway invocation must classify
daemon failures before Graphon re-raises that same ValueError from itself and loses its cause.
"""

from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl.exc import PluginDaemonInternalError

_PLUGIN_DAEMON_FAILURE_PREFIXES = (
    "Failed to request plugin daemon,",
    "Failed to parse response from plugin daemon",
    "got empty data from plugin daemon:",
    "plugin daemon: ",
    "Request to Plugin Daemon Service failed",
)


def normalize_agent_llm_plugin_error(
    error: BaseException, *, from_plugin_stream: bool
) -> PluginDaemonInternalError | None:
    """Return a classified daemon failure, or None to preserve the original exception.

    Call only from the Agent LLM gateway or its marked runtime invocation. Exact ValueError
    wrappers are recognized by daemon causes or the clients' fixed failure messages.
    BasePluginClient translates HTTP transport errors to PluginDaemonInnerError before
    PluginModelClient wraps them; classified plugin errors already propagate unchanged.
    At the plugin stream boundary, a ValueError caused by deserialization errors is also a
    protocol failure. Named ValueError subclasses retain their own classification. Traversal
    stops on repeated causes, and daemon messages omit legacy appended numeric error codes.
    The caller retains the original exception as the cause when raising a replacement.
    """
    fallback = "Request to Plugin Daemon Service failed"
    if isinstance(error, PluginDaemonInnerError):
        return PluginDaemonInternalError(error.message or fallback)
    if type(error) is not ValueError:
        return None

    cause = error.__cause__
    seen = {id(error)}
    while cause is not None and id(cause) not in seen:
        seen.add(id(cause))
        if isinstance(cause, PluginDaemonInnerError):
            return PluginDaemonInternalError(cause.message or fallback)
        cause = cause.__cause__

    message = str(error)
    if message.startswith(_PLUGIN_DAEMON_FAILURE_PREFIXES) or (
        from_plugin_stream and isinstance(error.__cause__, ValueError | TypeError)
    ):
        if message.startswith(fallback):
            message = message.removesuffix("-500")
        return PluginDaemonInternalError(message or fallback)
    return None
