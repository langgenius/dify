from core.model_runtime.model_providers.volcengine_maas.volc_sdk import MaasException


class ClientSDKRequestError(MaasException):
    pass


class SignatureDoesNotMatch(MaasException):
    pass


class RequestTimeout(MaasException):
    pass


class ServiceConnectionTimeout(MaasException):
    pass


class MissingAuthenticationHeader(MaasException):
    pass


class AuthenticationHeaderIsInvalid(MaasException):
    pass


class InternalServiceError(MaasException):
    pass


class MissingParameter(MaasException):
    pass


class InvalidParameter(MaasException):
    pass


class AuthenticationExpire(MaasException):
    pass


class EndpointIsInvalid(MaasException):
    pass


class EndpointIsNotEnable(MaasException):
    pass


class ModelNotSupportStreamMode(MaasException):
    pass


class ReqTextExistRisk(MaasException):
    pass


class RespTextExistRisk(MaasException):
    pass


class EndpointRateLimitExceeded(MaasException):
    pass


class ServiceConnectionRefused(MaasException):
    pass


class ServiceConnectionClosed(MaasException):
    pass


class UnauthorizedUserForEndpoint(MaasException):
    pass


class InvalidEndpointWithNoURL(MaasException):
    pass


class EndpointAccountRpmRateLimitExceeded(MaasException):
    pass


class EndpointAccountTpmRateLimitExceeded(MaasException):
    pass


class ServiceResourceWaitQueueFull(MaasException):
    pass


class EndpointIsPending(MaasException):
    pass


class ServiceNotOpen(MaasException):
    pass


AuthErrors = {
    'SignatureDoesNotMatch': SignatureDoesNotMatch,
    'MissingAuthenticationHeader': MissingAuthenticationHeader,
    'AuthenticationHeaderIsInvalid': AuthenticationHeaderIsInvalid,
    'AuthenticationExpire': AuthenticationExpire,
    'UnauthorizedUserForEndpoint': UnauthorizedUserForEndpoint,
}

BadRequestErrors = {
    'MissingParameter': MissingParameter,
    'InvalidParameter': InvalidParameter,
    'EndpointIsInvalid': EndpointIsInvalid,
    'EndpointIsNotEnable': EndpointIsNotEnable,
    'ModelNotSupportStreamMode': ModelNotSupportStreamMode,
    'ReqTextExistRisk': ReqTextExistRisk,
    'RespTextExistRisk': RespTextExistRisk,
    'InvalidEndpointWithNoURL': InvalidEndpointWithNoURL,
    'ServiceNotOpen': ServiceNotOpen,
}

RateLimitErrors = {
    'EndpointRateLimitExceeded': EndpointRateLimitExceeded,
    'EndpointAccountRpmRateLimitExceeded': EndpointAccountRpmRateLimitExceeded,
    'EndpointAccountTpmRateLimitExceeded': EndpointAccountTpmRateLimitExceeded,
}

ServerUnavailableErrors = {
    'InternalServiceError': InternalServiceError,
    'EndpointIsPending': EndpointIsPending,
    'ServiceResourceWaitQueueFull': ServiceResourceWaitQueueFull,
}

ConnectionErrors = {
    'ClientSDKRequestError': ClientSDKRequestError,
    'RequestTimeout': RequestTimeout,
    'ServiceConnectionTimeout': ServiceConnectionTimeout,
    'ServiceConnectionRefused': ServiceConnectionRefused,
    'ServiceConnectionClosed': ServiceConnectionClosed,
}

ErrorCodeMap = {
    **AuthErrors,
    **BadRequestErrors,
    **RateLimitErrors,
    **ServerUnavailableErrors,
    **ConnectionErrors,
}


def wrap_error(e: MaasException) -> Exception:
    if ErrorCodeMap.get(e.code):
        return ErrorCodeMap.get(e.code)(e.code_n, e.code, e.message, e.req_id)
    return e
