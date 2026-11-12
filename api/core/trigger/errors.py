"""Exceptions shared by plugin-daemon error decoding and trigger gateways.

Keep them outside services while the SDK remains in core. TODO: Move them with
the shared plugin SDK contracts, updating the decoder and gateway imports
together and preserving the class names used by daemon error mapping.
"""

from core.plugin.impl.exc import PluginInvokeError


class TriggerProviderCredentialValidationError(ValueError):
    pass


class TriggerPluginInvokeError(PluginInvokeError):
    pass


class TriggerInvokeError(PluginInvokeError):
    pass


class EventIgnoreError(TriggerInvokeError):
    """
    Trigger event ignore error
    """
