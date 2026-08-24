from __future__ import annotations

from datetime import datetime
from http import HTTPStatus
from typing import Annotated, Literal

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
    EmailChangeRateLimitExceededError,
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
    MissingInvitationCodeRequestError,
    RepeatPasswordNotMatchError,
)
from controllers.console.wraps import model_validate, setup_required
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.member_fields import AccountResponse
from libs.helper import EmailStr, dump_response, extract_remote_ip, timezone, to_timestamp
from machinery.context import RequestContext
from services import account_errors
from services.entities.account_entities import AccountProfileChanges


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
        except account_errors.AccountAlreadyInitializedError as error:
            raise AccountAlreadyInitedError() from error
        except account_errors.MissingInvitationCodeError as error:
            raise MissingInvitationCodeRequestError() from error
        except account_errors.InvalidInvitationCodeError as error:
            raise InvalidInvitationCodeError() from error
        except account_errors.AccountNotFoundError as error:
            raise AccountNotFound() from error

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

        application_services().accounts.deletion_feedback.submit(email=args.email, feedback=args.feedback)

        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route("/account/education/verify")
class EducationVerifyApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[EducationVerifyResponse.__name__])
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def get(self, request_context: RequestContext):
        try:
            verification = application_services().accounts.education.verify(request_context)
        except account_errors.AccountNotFoundError:
            raise AccountNotFound() from None
        return dump_response(EducationVerifyResponse, verification)


@console_ns.route("/account/education")
class EducationApi(Resource):
    @console_ns.expect(console_ns.models[EducationActivatePayload.__name__])
    # response-contract:ignore billing-service activation payload; TODO: model education activation result.
    @console_ns.response(HTTPStatus.OK, "Success")
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = EducationActivatePayload.model_validate(payload)
        try:
            return application_services().accounts.education.activate(
                request_context,
                token=args.token,
                institution=args.institution,
                role=args.role,
            )
        except account_errors.AccountNotFoundError:
            raise AccountNotFound() from None

    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[EducationStatusResponse.__name__])
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def get(self, request_context: RequestContext):
        return dump_response(EducationStatusResponse, application_services().accounts.education.status(request_context))


@console_ns.route("/account/education/autocomplete")
class EducationAutoCompleteApi(Resource):
    @console_ns.doc(params=query_params_from_model(EducationAutocompleteQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[EducationAutocompleteResponse.__name__])
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def get(self, request_context: RequestContext):
        payload = request.args.to_dict(flat=True)
        args = EducationAutocompleteQuery.model_validate(payload)

        return dump_response(
            EducationAutocompleteResponse,
            application_services().accounts.education.autocomplete(
                request_context,
                keywords=args.keywords,
                page=args.page,
                limit=args.limit,
            ),
        )


@console_ns.route("/account/change-email")
class ChangeEmailSendEmailApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailSendPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @console_account_admission(require_change_email_enabled=True)
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = ChangeEmailSendPayload.model_validate(payload)

        ip_address = extract_remote_ip(request)
        language = "zh-Hans" if args.language == "zh-Hans" else "en-US"
        try:
            token = application_services().accounts.change_email.send_code(
                request_context,
                requested_email=args.email,
                language=language,
                phase=args.phase,
                predecessor_token=args.token,
                ip_address=ip_address,
            )
        except account_errors.ChangeEmailSendIPLimitedError:
            raise EmailSendIpLimitError() from None
        except account_errors.ChangeEmailSendRateLimitError as error:
            raise EmailChangeRateLimitExceededError(error.retry_after_minutes) from None
        except account_errors.InvalidChangeEmailTokenError:
            raise InvalidTokenError() from None
        except account_errors.InvalidChangeEmailAddressError:
            raise InvalidEmailError() from None
        except account_errors.AccountNotFoundError:
            raise AccountNotFound() from None
        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@console_ns.route("/account/change-email/validity")
class ChangeEmailCheckApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailValidityPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[VerificationTokenResponse.__name__])
    @console_account_admission(require_change_email_enabled=True)
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = ChangeEmailValidityPayload.model_validate(payload)

        try:
            verification = application_services().accounts.change_email.verify_code(
                request_context,
                email=args.email,
                code=args.code,
                token=args.token,
            )
        except account_errors.ChangeEmailVerificationLimitError:
            raise EmailChangeLimitError() from None
        except account_errors.InvalidChangeEmailTokenError:
            raise InvalidTokenError() from None
        except account_errors.InvalidChangeEmailAddressError:
            raise InvalidEmailError() from None
        except account_errors.InvalidChangeEmailCodeError:
            raise EmailCodeError() from None
        return VerificationTokenResponse(is_valid=True, email=verification.email, token=verification.token).model_dump(
            mode="json"
        )


@console_ns.route("/account/change-email/reset")
class ChangeEmailResetApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailResetPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[AccountResponse.__name__])
    @console_account_admission(require_change_email_enabled=True)
    def post(self, request_context: RequestContext):
        payload = console_ns.payload or {}
        args = ChangeEmailResetPayload.model_validate(payload)
        try:
            updated_account = application_services().accounts.change_email.reset(
                request_context,
                new_email=args.new_email,
                token=args.token,
            )
        except account_errors.AccountEmailDomainSuspendedError:
            raise EmailDomainSuspendedError() from None
        except account_errors.AccountEmailFrozenError:
            raise AccountInFreezeError() from None
        except account_errors.AccountEmailAlreadyInUseError:
            raise EmailAlreadyInUseError() from None
        except account_errors.InvalidChangeEmailTokenError:
            raise InvalidTokenError() from None
        except account_errors.AccountNotFoundError:
            raise AccountNotFound() from None

        return dump_response(AccountResponse, updated_account)


@console_ns.route("/account/change-email/check-email-unique")
class CheckEmailUnique(Resource):
    @console_ns.expect(console_ns.models[CheckEmailUniquePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    def post(self):
        payload = console_ns.payload or {}
        args = CheckEmailUniquePayload.model_validate(payload)
        try:
            application_services().accounts.change_email.ensure_available(args.email)
        except account_errors.AccountEmailDomainSuspendedError:
            raise EmailDomainSuspendedError() from None
        except account_errors.AccountEmailFrozenError:
            raise AccountInFreezeError() from None
        except account_errors.AccountEmailAlreadyInUseError:
            raise EmailAlreadyInUseError() from None
        return SimpleResultResponse(result="success").model_dump(mode="json")
