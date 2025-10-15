from core.plugin.impl.exc import PluginInvokeError


class TriggerProviderCredentialValidationError(ValueError):
    pass


class TriggerPluginInvokeError(PluginInvokeError):
    pass


class TriggerInvokeError(Exception):
    pass


class TriggerIgnoreEventError(TriggerInvokeError):
    pass
