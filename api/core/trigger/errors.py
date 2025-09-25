class TriggerProviderCredentialValidationError(ValueError):
    pass


class TriggerInvokeError(Exception):
    pass


class TriggerIgnoreEventError(TriggerInvokeError):
    pass
