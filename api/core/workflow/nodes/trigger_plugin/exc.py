class TriggerEventNodeError(ValueError):
    """Base exception for plugin trigger node errors."""

    pass


class TriggerEventParameterError(TriggerEventNodeError):
    """Exception raised for errors in plugin trigger parameters."""

    pass
