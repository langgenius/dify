from core.plugin.impl.exc import PluginInvokeError


class PluginNotImplementedError(PluginInvokeError):
    """The plugin explicitly reports that an operation is not implemented."""
