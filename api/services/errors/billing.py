class BillingError(Exception):
    pass


class BillingUpstreamInvalidResponseError(BillingError):
    pass


class BillingUpstreamUnavailableError(BillingError):
    pass
