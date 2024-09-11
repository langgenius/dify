from core.model_runtime.model_providers.volcengine_maas.legacy.volc_sdk import MaasExceptionError


class ClientSDKRequestError(MaasExceptionError):
    pass


class SignatureDoesNotMatchError(MaasExceptionError):
    pass


class RequestTimeoutError(MaasExceptionError):
    pass


class ServiceConnectionTimeoutError(MaasExceptionError):
    pass


class MissingAuthenticationHeaderError(MaasExceptionError):
    pass


class AuthenticationHeaderIsInvalidError(MaasExceptionError):
    pass


class InternalServiceError(MaasExceptionError):
    pass


class MissingParameterError(MaasExceptionError):
    pass


class InvalidParameterError(MaasExceptionError):
    pass


class AuthenticationExpireError(MaasExceptionError):
    pass


class EndpointIsInvalidError(MaasExceptionError):
    pass


class EndpointIsNotEnableError(MaasExceptionError):
    pass


class ModelNotSupportStreamModeError(MaasExceptionError):
    pass


class ReqTextExistRiskError(MaasExceptionError):
    pass


class RespTextExistRiskError(MaasExceptionError):
    pass


class EndpointRateLimitExceededError(MaasExceptionError):
    pass


class ServiceConnectionRefusedError(MaasExceptionError):
    pass


class ServiceConnectionClosedError(MaasExceptionError):
    pass


class UnauthorizedUserForEndpointError(MaasExceptionError):
    pass


class InvalidEndpointWithNoURLError(MaasExceptionError):
    pass


class EndpointAccountRpmRateLimitExceededError(MaasExceptionError):
    pass


class EndpointAccountTpmRateLimitExceededError(MaasExceptionError):
    pass


class ServiceResourceWaitQueueFullError(MaasExceptionError):
    pass


class EndpointIsPendingError(MaasExceptionError):
    pass


class ServiceNotOpenError(MaasExceptionError):
    pass


AuthErrors = {
    "SignatureDoesNotMatch": SignatureDoesNotMatchError,
    "MissingAuthenticationHeader": MissingAuthenticationHeaderError,
    "AuthenticationHeaderIsInvalid": AuthenticationHeaderIsInvalidError,
    "AuthenticationExpire": AuthenticationExpireError,
    "UnauthorizedUserForEndpoint": UnauthorizedUserForEndpointError,
}

BadRequestErrors = {
    "MissingParameter": MissingParameterError,
    "InvalidParameter": InvalidParameterError,
    "EndpointIsInvalid": EndpointIsInvalidError,
    "EndpointIsNotEnable": EndpointIsNotEnableError,
    "ModelNotSupportStreamMode": ModelNotSupportStreamModeError,
    "ReqTextExistRisk": ReqTextExistRiskError,
    "RespTextExistRisk": RespTextExistRiskError,
    "InvalidEndpointWithNoURL": InvalidEndpointWithNoURLError,
    "ServiceNotOpen": ServiceNotOpenError,
}

RateLimitErrors = {
    "EndpointRateLimitExceeded": EndpointRateLimitExceededError,
    "EndpointAccountRpmRateLimitExceeded": EndpointAccountRpmRateLimitExceededError,
    "EndpointAccountTpmRateLimitExceeded": EndpointAccountTpmRateLimitExceededError,
}

ServerUnavailableErrors = {
    "InternalServiceError": InternalServiceError,
    "EndpointIsPending": EndpointIsPendingError,
    "ServiceResourceWaitQueueFull": ServiceResourceWaitQueueFullError,
}

ConnectionErrors = {
    "ClientSDKRequestError": ClientSDKRequestError,
    "RequestTimeout": RequestTimeoutError,
    "ServiceConnectionTimeout": ServiceConnectionTimeoutError,
    "ServiceConnectionRefused": ServiceConnectionRefusedError,
    "ServiceConnectionClosed": ServiceConnectionClosedError,
}

ErrorCodeMap = {
    **AuthErrors,
    **BadRequestErrors,
    **RateLimitErrors,
    **ServerUnavailableErrors,
    **ConnectionErrors,
}


def wrap_error(e: MaasExceptionError) -> Exception:
    if ErrorCodeMap.get(e.code):
        return ErrorCodeMap.get(e.code)(e.code_n, e.code, e.message, e.req_id)
    return e
