from __future__ import annotations

from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Literal

import pytz
from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema
from werkzeug.exceptions import NotFound

from constants.languages import supported_language
from controllers.common.fields import (
    AvatarUrlResponse,
    SimpleResultDataResponse,
    SimpleResultResponse,
    VerificationTokenResponse,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailChangeLimitError,
    EmailCodeAccountDeletionRateLimitExceededError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
)
from controllers.console.error import (
    AccountInFreezeError,
    AccountNotFound,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.error import (
    AccountAlreadyInitedError,
    CurrentPasswordIncorrectError,
    InvalidAccountDeletionCodeError,
    InvalidAccountPasswordRequestError,
    InvalidInvitationCodeError,
    RepeatPasswordNotMatchError,
)
from controllers.console.wraps import (
    account_initialization_required,
    enable_change_email,
    model_validate,
    only_edition_cloud,
    setup_required,
    with_current_user,
)
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.member_fields import AccountResponse
from libs.helper import EmailStr, dump_response, extract_remote_ip, timezone, to_timestamp
from libs.login import login_required
from machinery.context import RequestContext
from models import Account
from services import account_errors
from services.account_service import AccountService
from services.billing_service import BillingService
from services.entities.account_entities import AccountProfileChanges
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailNewEmailVerifiedToken,
    ChangeEmailOldEmailToken,
    ChangeEmailOldEmailVerifiedToken,
)


class AccountInitPayload(BaseModel):
    interface_language: str
    timezone: str
    invitation_code: str | None = None

    @field_validator("interface_language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return supported_language(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return timezone(value)


class AccountNamePayload(BaseModel):
    name: str = Field(min_length=3, max_length=30)


class AccountAvatarPayload(BaseModel):
    avatar: str


class AccountAvatarQuery(BaseModel):
    avatar: str = Field(..., description="Avatar file ID")


class AccountInterfaceLanguagePayload(BaseModel):
    interface_language: str

    @field_validator("interface_language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return supported_language(value)


class AccountInterfaceThemePayload(BaseModel):
    interface_theme: Literal["light", "dark"]


class AccountTimezonePayload(BaseModel):
    timezone: str

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return timezone(value)


class AccountProfilePatchPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=3, max_length=30)] | SkipJsonSchema[None] = None
    avatar: str | SkipJsonSchema[None] = None
    interface_language: str | SkipJsonSchema[None] = None
    interface_theme: Literal["light", "dark"] | SkipJsonSchema[None] = None
    timezone: str | SkipJsonSchema[None] = None

    @field_validator("*", mode="before")
    @classmethod
    def reject_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Account profile fields cannot be null")
        return value

    @field_validator("interface_language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return supported_language(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return timezone(value)

    def to_changes(self) -> AccountProfileChanges:
        return AccountProfileChanges(
            name=self.name,
            avatar=self.avatar,
            interface_language=self.interface_language,
            interface_theme=self.interface_theme,
            timezone=self.timezone,
        )


class AccountPasswordPayload(BaseModel):
    password: str | None = None
    new_password: str
    repeat_new_password: str

    @model_validator(mode="after")
    def check_passwords_match(self) -> AccountPasswordPayload:
        if self.new_password != self.repeat_new_password:
            raise RepeatPasswordNotMatchError()
        return self


class AccountDeletePayload(BaseModel):
    token: str
    code: str


class AccountDeletionFeedbackPayload(BaseModel):
    email: EmailStr
    feedback: str


class EducationActivatePayload(BaseModel):
    token: str
    institution: str
    role: str


class EducationAutocompleteQuery(BaseModel):
    keywords: str
    page: int = 0
    limit: int = 20


class ChangeEmailSendPayload(BaseModel):
    email: EmailStr
    language: str | None = None
    phase: str | None = None
    token: str | None = None


class ChangeEmailValidityPayload(BaseModel):
    email: EmailStr
    code: str
    token: str


class ChangeEmailResetPayload(BaseModel):
    new_email: EmailStr
    token: str


class CheckEmailUniquePayload(BaseModel):
    email: EmailStr


register_schema_models(
    console_ns,
    AccountInitPayload,
    AccountNamePayload,
    AccountAvatarPayload,
    AccountAvatarQuery,
    AccountInterfaceLanguagePayload,
    AccountInterfaceThemePayload,
    AccountTimezonePayload,
    AccountProfilePatchPayload,
    AccountPasswordPayload,
    AccountDeletePayload,
    AccountDeletionFeedbackPayload,
    EducationActivatePayload,
    EducationAutocompleteQuery,
    ChangeEmailSendPayload,
    ChangeEmailValidityPayload,
    ChangeEmailResetPayload,
    CheckEmailUniquePayload,
)


class AccountIntegrateResponse(ResponseModel):
    provider: str
    created_at: int | None = None
    is_bound: bool
    link: str | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AccountIntegrateListResponse(ResponseModel):
    data: list[AccountIntegrateResponse]


class EducationVerifyResponse(ResponseModel):
    token: str | None = None


class EducationStatusResponse(ResponseModel):
    result: bool | None = None
    is_student: bool | None = None
    expire_at: int | None = None
    allow_refresh: bool | None = None

    @field_validator("expire_at", mode="before")
    @classmethod
    def _normalize_expire_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class EducationAutocompleteResponse(ResponseModel):
    data: list[str] = Field(default_factory=list)
    curr_page: int | None = None
    has_next: bool | None = None


register_response_schema_models(
    console_ns,
    AccountResponse,
    AccountIntegrateResponse,
    AccountIntegrateListResponse,
    AvatarUrlResponse,
    EducationVerifyResponse,
    EducationStatusResponse,
    EducationAutocompleteResponse,
    SimpleResultDataResponse,
    SimpleResultResponse,
    VerificationTokenResponse,
)


def _update_account_profile(request_context: RequestContext, changes: AccountProfileChanges) -> dict[str, object]:
    try:
        account = application_services().accounts.profile.update(request_context, changes)
    except account_errors.AccountNotFoundError as error:
        raise AccountNotFound() from error
    return dump_response(AccountResponse, account)


@console_ns.route("/account/init")
class AccountInitApi(Resource):
    @console_ns.expect(console_ns.models[AccountInitPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(require_initialized=False)
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountInitPayload.model_validate(payload)

        try:
            application_services().accounts.initialization.initialize(
                request_context,
                interface_language=args.interface_language,
                timezone=args.timezone,
                invitation_code=args.invitation_code,
            )
        except account_errors.AccountAlreadyInitializedError:
            raise AccountAlreadyInitedError() from None
        except account_errors.InvalidInvitationCodeError:
            raise InvalidInvitationCodeError() from None
        except account_errors.AccountNotFoundError:
            raise AccountNotFound() from None

        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/account/profile")
class AccountProfileApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission(require_valid_enterprise_license=True)
    def get(self, request_context: RequestContext):
        try:
            account = application_services().accounts.profile.get(request_context)
        except account_errors.AccountNotFoundError as error:
            raise AccountNotFound() from error
        return dump_response(AccountResponse, account)

    @console_ns.expect(console_ns.models[AccountProfilePatchPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission()
    @model_validate(AccountProfilePatchPayload)
    def patch(self, args: AccountProfilePatchPayload, request_context: RequestContext):
        return _update_account_profile(request_context, args.to_changes())


@console_ns.route("/account/name")
class AccountNameApi(Resource):
    """Deprecated compatibility route; use PATCH /account/profile."""

    @console_ns.doc("update_account_name_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(description="Deprecated. Use PATCH /account/profile instead.")
    @console_ns.expect(console_ns.models[AccountNamePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountNamePayload.model_validate(payload)
        return _update_account_profile(request_context, AccountProfileChanges(name=args.name))


@console_ns.route("/account/avatar")
class AccountAvatarApi(Resource):
    @console_ns.doc("get_account_avatar")
    @console_ns.doc(description="Get account avatar url")
    @console_ns.doc(params=query_params_from_model(AccountAvatarQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AvatarUrlResponse.__name__])
    @console_account_admission()
    @model_validate(AccountAvatarQuery)
    def get(self, args: AccountAvatarQuery, request_context: RequestContext):
        try:
            avatar_url = application_services().accounts.avatar.resolve(request_context, args.avatar)
        except account_errors.AvatarFileNotFoundError as error:
            raise NotFound("Avatar file not found") from error
        return AvatarUrlResponse(avatar_url=avatar_url).model_dump(mode="json")

    @console_ns.expect(console_ns.models[AccountAvatarPayload.__name__])
    @console_ns.doc("update_account_avatar_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(description="Deprecated. Use PATCH /account/profile instead.")
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountAvatarPayload.model_validate(payload)
        return _update_account_profile(request_context, AccountProfileChanges(avatar=args.avatar))


@console_ns.route("/account/interface-language")
class AccountInterfaceLanguageApi(Resource):
    """Deprecated compatibility route; use PATCH /account/profile."""

    @console_ns.doc("update_account_interface_language_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(description="Deprecated. Use PATCH /account/profile instead.")
    @console_ns.expect(console_ns.models[AccountInterfaceLanguagePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountInterfaceLanguagePayload.model_validate(payload)
        return _update_account_profile(
            request_context,
            AccountProfileChanges(interface_language=args.interface_language),
        )


@console_ns.route("/account/interface-theme")
class AccountInterfaceThemeApi(Resource):
    """Deprecated compatibility route; use PATCH /account/profile."""

    @console_ns.doc("update_account_interface_theme_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(description="Deprecated. Use PATCH /account/profile instead.")
    @console_ns.expect(console_ns.models[AccountInterfaceThemePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountInterfaceThemePayload.model_validate(payload)
        return _update_account_profile(
            request_context,
            AccountProfileChanges(interface_theme=args.interface_theme),
        )


@console_ns.route("/account/timezone")
class AccountTimezoneApi(Resource):
    """Deprecated compatibility route; use PATCH /account/profile."""

    @console_ns.doc("update_account_timezone_deprecated")
    @console_ns.doc(deprecated=True)
    @console_ns.doc(description="Deprecated. Use PATCH /account/profile instead.")
    @console_ns.expect(console_ns.models[AccountTimezonePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountTimezonePayload.model_validate(payload)
        return _update_account_profile(request_context, AccountProfileChanges(timezone=args.timezone))


@console_ns.route("/account/password")
class AccountPasswordApi(Resource):
    @console_ns.expect(console_ns.models[AccountPasswordPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountPasswordPayload.model_validate(payload)

        try:
            assert args.password is not None
            account = application_services().accounts.password.change(
                request_context,
                current_password=args.password,
                new_password=args.new_password,
            )
        except account_errors.CurrentAccountPasswordIncorrectError as error:
            raise CurrentPasswordIncorrectError() from error
        except account_errors.InvalidAccountPasswordError as error:
            raise InvalidAccountPasswordRequestError(description=str(error)) from error
        except account_errors.AccountNotFoundError as error:
            raise AccountNotFound() from error

        return dump_response(AccountResponse, account)


@console_ns.route("/account/integrates")
class AccountIntegrateApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountIntegrateListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        base_url = request.url_root.rstrip("/")
        oauth_base_path = "/console/api/oauth/login"
        integrations = application_services().accounts.integrations.list(request_context)
        integrate_data = [
            AccountIntegrateResponse(
                provider=integration.provider,
                created_at=to_timestamp(integration.created_at),
                is_bound=integration.is_bound,
                link=(None if integration.is_bound else f"{base_url}{oauth_base_path}/{integration.provider}"),
            )
            for integration in integrations
        ]

        return AccountIntegrateListResponse(data=integrate_data).model_dump(mode="json")


@console_ns.route("/account/delete/verify")
class AccountDeleteVerifyApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        try:
            token = application_services().accounts.deletion.issue_verification(request_context)
        except account_errors.AccountDeletionRateLimitError as error:
            raise EmailCodeAccountDeletionRateLimitExceededError(error.retry_after_minutes) from None
        except account_errors.AccountNotFoundError:
            raise AccountNotFound() from None

        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@console_ns.route("/account/delete")
class AccountDeleteApi(Resource):
    @console_ns.expect(console_ns.models[AccountDeletePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = AccountDeletePayload.model_validate(payload)

        try:
            application_services().accounts.deletion.request_deletion(
                request_context,
                token=args.token,
                code=args.code,
            )
        except account_errors.InvalidAccountDeletionVerificationError:
            raise InvalidAccountDeletionCodeError() from None

        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/account/delete/feedback")
class AccountDeleteUpdateFeedbackApi(Resource):
    @console_ns.expect(console_ns.models[AccountDeletionFeedbackPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    def post(self):
        payload = console_ns.payload or {}
        args = AccountDeletionFeedbackPayload.model_validate(payload)

        BillingService.update_account_deletion_feedback(args.email, args.feedback)

        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/account/education/verify")
class EducationVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[EducationVerifyResponse.__name__])
    @with_current_user
    def get(self, account: Account):
        return dump_response(
            EducationVerifyResponse, BillingService.EducationIdentity.verify(account.id, account.email) or {}
        )


@console_ns.route("/account/education")
class EducationApi(Resource):
    @console_ns.expect(console_ns.models[EducationActivatePayload.__name__])
    # response-contract:ignore billing-service activation payload; TODO: model education activation result.
    @console_ns.response(HTTPStatus.OK, "Success")
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    def post(self, account: Account):
        payload = console_ns.payload or {}
        args = EducationActivatePayload.model_validate(payload)

        result = BillingService.EducationIdentity.activate(account, args.token, args.institution, args.role)
        return result

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[EducationStatusResponse.__name__])
    @with_current_user
    def get(self, account: Account):
        res = BillingService.EducationIdentity.status(account.id) or {}
        # convert expire_at to UTC timestamp from isoformat
        if res and "expire_at" in res:
            res["expire_at"] = datetime.fromisoformat(res["expire_at"]).astimezone(pytz.utc)
        return dump_response(EducationStatusResponse, res)


@console_ns.route("/account/education/autocomplete")
class EducationAutoCompleteApi(Resource):
    @console_ns.doc(params=query_params_from_model(EducationAutocompleteQuery))
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[EducationAutocompleteResponse.__name__])
    def get(self):
        payload = request.args.to_dict(flat=True)
        args = EducationAutocompleteQuery.model_validate(payload)

        return dump_response(
            EducationAutocompleteResponse,
            BillingService.EducationIdentity.autocomplete(args.keywords, args.page, args.limit) or {},
        )


@console_ns.route("/account/change-email")
class ChangeEmailSendEmailApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailSendPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = ChangeEmailSendPayload.model_validate(payload)

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if args.language is not None and args.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        account = current_user
        user_email = current_user.email
        email_for_sending = args.email.lower()
        # Default to the initial phase; any legacy/unexpected client input is
        # coerced back to `old_email` so we never trust the caller to declare
        # later phases without a verified predecessor token.
        send_phase = AccountService.CHANGE_EMAIL_PHASE_OLD
        if args.phase is not None and args.phase == AccountService.CHANGE_EMAIL_PHASE_NEW:
            send_phase = AccountService.CHANGE_EMAIL_PHASE_NEW
            if args.token is None:
                raise InvalidTokenError()

            reset_data = AccountService.get_change_email_data(args.token)
            if reset_data is None:
                raise InvalidTokenError()

            if not isinstance(reset_data, ChangeEmailOldEmailVerifiedToken):
                raise InvalidTokenError()
            if not reset_data.is_bound_to_account(current_user.id):
                raise InvalidTokenError()
            user_email = reset_data.email

            if user_email.lower() != current_user.email.lower():
                raise InvalidEmailError()
        else:
            if email_for_sending != current_user.email.lower():
                raise InvalidEmailError()
            email_for_sending = current_user.email

        token = AccountService.send_change_email_email(
            account=account,
            email=email_for_sending,
            old_email=user_email,
            language=language,
            phase=send_phase,
        )
        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@console_ns.route("/account/change-email/validity")
class ChangeEmailCheckApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailValidityPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[VerificationTokenResponse.__name__])
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = ChangeEmailValidityPayload.model_validate(payload)

        user_email = args.email.lower()

        is_change_email_error_rate_limit = AccountService.is_change_email_error_rate_limit(user_email)
        if is_change_email_error_rate_limit:
            raise EmailChangeLimitError()

        token_data = AccountService.get_change_email_data(args.token)
        if token_data is None:
            raise InvalidTokenError()
        if not token_data.is_bound_to_account(current_user.id):
            raise InvalidTokenError()

        normalized_token_email = token_data.email.lower()
        if user_email != normalized_token_email:
            raise InvalidEmailError()

        if args.code != token_data.code:
            AccountService.add_change_email_error_rate_limit(user_email)
            raise EmailCodeError()

        if isinstance(token_data, ChangeEmailOldEmailToken | ChangeEmailNewEmailToken):
            refreshed_token_data = token_data.promote()
        else:
            raise InvalidTokenError()

        # Verified, revoke the first token
        AccountService.revoke_change_email_token(args.token)

        new_token = AccountService.generate_change_email_token(refreshed_token_data, current_user)

        AccountService.reset_change_email_error_rate_limit(user_email)
        return VerificationTokenResponse(is_valid=True, email=normalized_token_email, token=new_token).model_dump(
            mode="json"
        )


@console_ns.route("/account/change-email/reset")
class ChangeEmailResetApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailResetPayload.__name__])
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = ChangeEmailResetPayload.model_validate(payload)
        normalized_new_email = args.new_email.lower()

        freeze_type = AccountService.get_account_freeze_type(normalized_new_email)
        if freeze_type:
            if freeze_type == "email_domain_suspended":
                raise EmailDomainSuspendedError()
            raise AccountInFreezeError()

        if not AccountService.check_email_unique(normalized_new_email, session=db.session()):
            raise EmailAlreadyInUseError()

        reset_data = AccountService.get_change_email_data(args.token)
        if not reset_data:
            raise InvalidTokenError()
        if not reset_data.is_bound_to_account(current_user.id):
            raise InvalidTokenError()

        if not isinstance(reset_data, ChangeEmailNewEmailVerifiedToken):
            raise InvalidTokenError()

        # Bind the new email to the token that was mailed and verified, so a
        # verified token cannot be reused with a different `new_email` value.
        if reset_data.email.lower() != normalized_new_email:
            raise InvalidTokenError()

        if current_user.email.lower() != reset_data.old_email.lower():
            raise AccountNotFound()

        # Revoke only after all checks pass so failed attempts don't burn a
        # legitimately verified token.
        AccountService.revoke_change_email_token(args.token)

        updated_account = AccountService.update_account_email(
            current_user, email=normalized_new_email, session=db.session()
        )

        AccountService.send_change_email_completed_notify_email(
            email=normalized_new_email,
        )

        return dump_response(AccountResponse, updated_account)


@console_ns.route("/account/change-email/check-email-unique")
class CheckEmailUnique(Resource):
    @console_ns.expect(console_ns.models[CheckEmailUniquePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    def post(self):
        payload = console_ns.payload or {}
        args = CheckEmailUniquePayload.model_validate(payload)
        normalized_email = args.email.lower()
        freeze_type = AccountService.get_account_freeze_type(normalized_email)
        if freeze_type:
            if freeze_type == "email_domain_suspended":
                raise EmailDomainSuspendedError()
            raise AccountInFreezeError()
        if not AccountService.check_email_unique(normalized_email, session=db.session()):
            raise EmailAlreadyInUseError()
        return SimpleResultResponse(result="success").model_dump(mode="json")
