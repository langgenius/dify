"""Shared email-change transport behavior after surface-specific Account admission.

Payload validation, service arguments, shared HTTP errors and verification responses
have one owner. Account-not-found errors remain unmodified so each surface can retain
its authentication contract; Account serialization also belongs to the surface.
"""

from collections.abc import Generator
from contextlib import contextmanager

from controllers.account_email_errors import (
    AccountInFreezeError,
    EmailAlreadyInUseError,
    EmailChangeLimitError,
    EmailChangeRateLimitExceededError,
    EmailCodeError,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
    InvalidEmailError,
    InvalidTokenError,
)
from controllers.common.account import (
    ChangeEmailResetPayload,
    ChangeEmailSendPayload,
    ChangeEmailValidityPayload,
    CheckEmailUniquePayload,
)
from controllers.common.fields import SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse
from machinery.context import AccountRequestContext, RequestContext
from services import account_errors
from services.account_change_email_service import AccountChangeEmailService
from services.entities.account_entities import AccountSnapshot


@contextmanager
def _change_email_errors() -> Generator[None]:
    """Map shared application failures to HTTP errors; preserve unknown and missing-Account failures."""
    try:
        yield
    except account_errors.ChangeEmailSendIPLimitedError as error:
        raise EmailSendIpLimitError() from error
    except account_errors.ChangeEmailSendRateLimitError as error:
        raise EmailChangeRateLimitExceededError(error.retry_after_minutes) from error
    except account_errors.ChangeEmailVerificationLimitError as error:
        raise EmailChangeLimitError() from error
    except account_errors.InvalidChangeEmailTokenError as error:
        raise InvalidTokenError() from error
    except account_errors.InvalidChangeEmailAddressError as error:
        raise InvalidEmailError() from error
    except account_errors.InvalidChangeEmailCodeError as error:
        raise EmailCodeError() from error
    except account_errors.AccountEmailDomainSuspendedError as error:
        raise EmailDomainSuspendedError() from error
    except account_errors.AccountEmailFrozenError as error:
        raise AccountInFreezeError() from error
    except account_errors.AccountEmailAlreadyInUseError as error:
        raise EmailAlreadyInUseError() from error


def send_change_email_code(
    service: AccountChangeEmailService,
    context: AccountRequestContext | RequestContext,
    payload: object,
    *,
    ip_address: str,
) -> SimpleResultDataResponse:
    """Validate an admitted caller's payload and send its challenge without changing the Account.

    Raw bodies and validated payloads share language normalization and error mapping.
    Invalid input never reaches the service; missing Accounts remain surface-specific.
    """
    args = ChangeEmailSendPayload.model_validate(payload)
    with _change_email_errors():
        token = service.send_code(
            context,
            requested_email=args.email,
            language="zh-Hans" if args.language == "zh-Hans" else "en-US",
            phase=args.phase,
            predecessor_token=args.token,
            ip_address=ip_address,
        )
    return SimpleResultDataResponse(result="success", data=token)


def verify_change_email_code(
    service: AccountChangeEmailService, context: AccountRequestContext | RequestContext, payload: object
) -> VerificationTokenResponse:
    """Validate an admitted caller's challenge and return its promoted token without changing identity.

    Invalid payloads never reach the service; verification failures retain the shared HTTP contract.
    """
    args = ChangeEmailValidityPayload.model_validate(payload)
    with _change_email_errors():
        verified = service.verify_code(context, email=args.email, code=args.code, token=args.token)
    return VerificationTokenResponse(is_valid=True, email=verified.email, token=verified.token)


def reset_change_email(
    service: AccountChangeEmailService, context: AccountRequestContext | RequestContext, payload: object
) -> AccountSnapshot:
    """Validate an admitted caller's reset and return its updated Account for surface-specific serialization.

    Shared failures become HTTP errors; missing Accounts propagate unchanged. Only the
    application service may update identity after successful verification and policy checks.
    """
    args = ChangeEmailResetPayload.model_validate(payload)
    with _change_email_errors():
        return service.reset(context, new_email=args.new_email, token=args.token)


def check_change_email_available(service: AccountChangeEmailService, payload: object) -> SimpleResultResponse:
    """Validate an admitted caller's address and check availability without account or token mutations.

    Invalid input never reaches the service; policy failures use the shared HTTP contract.
    """
    args = CheckEmailUniquePayload.model_validate(payload)
    with _change_email_errors():
        service.ensure_available(args.email)
    return SimpleResultResponse(result="success")
