class BillingError(Exception):
    pass


class ComplianceRateLimitExceededError(BillingError):
    pass


class BillingUpstreamInvalidResponseError(BillingError):
    pass


class BillingUpstreamUnavailableError(BillingError):
    pass


class LegacyCreditPoolManagedByTokenerError(BillingError):
    """A legacy balance read crossed the irreversible Tokener cutover fence."""


class TokenerEducationCheckoutUnsupportedError(BillingError):
    pass
