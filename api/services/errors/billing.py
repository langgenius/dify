class BillingError(Exception):
    pass


class ComplianceRateLimitExceededError(BillingError):
    pass


class BillingUpstreamInvalidResponseError(BillingError):
    pass


class BillingUpstreamUnavailableError(BillingError):
    pass
