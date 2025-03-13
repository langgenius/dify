from core.model_runtime.model_providers.volcengine_maas.legacy.volc_sdk import MaasError


class ClientSDKRequestError(MaasError):
    pass


class SignatureDoesNotMatchError(MaasError):
    pass


class RequestTimeoutError(MaasError):
    pass


class ServiceConnectionTimeoutError(MaasError):
    pass


class MissingAuthenticationHeaderError(MaasError):
    pass


class AuthenticationHeaderIsInvalidError(MaasError):
    pass


class InternalServiceError(MaasError):
    pass


class MissingParameterError(MaasError):
    pass


class InvalidParameterError(MaasError):
    pass


class AuthenticationExpireError(MaasError):
    pass


class EndpointIsInvalidError(MaasError):
    pass


class EndpointIsNotEnableError(MaasError):
    pass


class ModelNotSupportStreamModeError(MaasError):
    pass


class ReqTextExistRiskError(MaasError):
    pass


class RespTextExistRiskError(MaasError):
    pass


class EndpointRateLimitExceededError(MaasError):
    pass


class ServiceConnectionRefusedError(MaasError):
    pass


class ServiceConnectionClosedError(MaasError):
    pass


class UnauthorizedUserForEndpointError(MaasError):
    pass


class InvalidEndpointWithNoURLError(MaasError):
    pass


class EndpointAccountRpmRateLimitExceededError(MaasError):
    pass


class EndpointAccountTpmRateLimitExceededError(MaasError):
    pass


class ServiceResourceWaitQueueFullError(MaasError):
    pass


class EndpointIsPendingError(MaasError):
    pass


class ServiceNotOpenError(MaasError):
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


def wrap_error(e: MaasError) -> Exception:
    if ErrorCodeMap.get(e.code):
        # FIXME: mypy type error, try to fix it instead of using type: ignore
        return ErrorCodeMap.get(e.code)(e.code_n, e.code, e.message, e.req_id)  # type: ignore
    return e
