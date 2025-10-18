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
