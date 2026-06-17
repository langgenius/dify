from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

import pytz
from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel, field_validator, model_validator
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from configs import dify_config
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
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
)
from controllers.console.error import AccountInFreezeError, AccountNotFound, EmailSendIpLimitError
from controllers.console.workspace.error import (
    AccountAlreadyInitedError,
    CurrentPasswordIncorrectError,
    InvalidAccountDeletionCodeError,
    InvalidInvitationCodeError,
    RepeatPasswordNotMatchError,
)
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_enabled,
    enable_change_email,
    enterprise_license_required,
    only_edition_cloud,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.member_fields import Account as AccountResponse
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now
from libs.helper import EmailStr, dump_response, extract_remote_ip, timezone, to_timestamp
from libs.login import login_required
from models import Account, AccountIntegrate, InvitationCode
from models.account import AccountStatus, InvitationCodeStatus
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.account_service import AccountService
from services.billing_service import BillingService
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailNewEmailVerifiedToken,
    ChangeEmailOldEmailToken,
    ChangeEmailOldEmailVerifiedToken,
)
from services.errors.account import CurrentPasswordIncorrectError as ServiceCurrentPasswordIncorrectError


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


def _serialize_account(account) -> dict[str, Any]:
    return AccountResponse.model_validate(account, from_attributes=True).model_dump(mode="json")


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


class EducationActivateResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]


register_schema_models(
    console_ns,
    AccountIntegrateResponse,
    AccountIntegrateListResponse,
    EducationVerifyResponse,
    EducationStatusResponse,
    EducationAutocompleteResponse,
)
register_response_schema_models(
    console_ns,
    AccountResponse,
    AvatarUrlResponse,
    EducationActivateResponse,
    SimpleResultDataResponse,
    SimpleResultResponse,
    VerificationTokenResponse,
)


@console_ns.route("/account/init")
class AccountInitApi(Resource):
    @console_ns.expect(console_ns.models[AccountInitPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @with_current_user
    def post(self, account: Account):
        if account.status == "active":
            raise AccountAlreadyInitedError()

        payload = console_ns.payload or {}
        args = AccountInitPayload.model_validate(payload)

        if dify_config.EDITION == "CLOUD":
            if not args.invitation_code:
                raise ValueError("invitation_code is required")

            # check invitation code
            invitation_code = db.session.scalar(
                select(InvitationCode)
                .where(
                    InvitationCode.code == args.invitation_code,
                    InvitationCode.status == InvitationCodeStatus.UNUSED,
                )
                .limit(1)
            )

            if not invitation_code:
                raise InvalidInvitationCodeError()

            invitation_code.status = InvitationCodeStatus.USED
            invitation_code.used_at = naive_utc_now()
            invitation_code.used_by_tenant_id = account.current_tenant_id
            invitation_code.used_by_account_id = account.id

        account.interface_language = args.interface_language
        account.timezone = args.timezone
        account.interface_theme = "light"
        account.status = AccountStatus.ACTIVE
        account.initialized_at = naive_utc_now()
        db.session.commit()

        return {"result": "success"}


@console_ns.route("/account/profile")
class AccountProfileApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @enterprise_license_required
    @with_current_user
    def get(self, current_user: Account):
        return _serialize_account(current_user)


@console_ns.route("/account/name")
class AccountNameApi(Resource):
    @console_ns.expect(console_ns.models[AccountNamePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = AccountNamePayload.model_validate(payload)
        updated_account = AccountService.update_account(current_user, name=args.name)

        return _serialize_account(updated_account)


@console_ns.route("/account/avatar")
class AccountAvatarApi(Resource):
    @console_ns.doc("get_account_avatar")
    @console_ns.doc(description="Get account avatar url")
    @console_ns.doc(params=query_params_from_model(AccountAvatarQuery))
    @console_ns.response(200, "Success", console_ns.models[AvatarUrlResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        args = AccountAvatarQuery.model_validate(request.args.to_dict(flat=True))
        avatar = args.avatar

        if avatar.startswith(("http://", "https://")):
            return dump_response(AvatarUrlResponse, {"avatar_url": avatar})

        upload_file = db.session.scalar(select(UploadFile).where(UploadFile.id == avatar).limit(1))
        if upload_file is None:
            raise NotFound("Avatar file not found")

        if upload_file.tenant_id != current_tenant_id:
            raise NotFound("Avatar file not found")

        if upload_file.created_by_role != CreatorUserRole.ACCOUNT or upload_file.created_by != current_user.id:
            raise NotFound("Avatar file not found")

        avatar_url = file_helpers.get_signed_file_url(upload_file_id=upload_file.id)
        return dump_response(AvatarUrlResponse, {"avatar_url": avatar_url})

    @console_ns.expect(console_ns.models[AccountAvatarPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = AccountAvatarPayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, avatar=args.avatar)

        return _serialize_account(updated_account)


@console_ns.route("/account/interface-language")
class AccountInterfaceLanguageApi(Resource):
    @console_ns.expect(console_ns.models[AccountInterfaceLanguagePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = AccountInterfaceLanguagePayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, interface_language=args.interface_language)

        return _serialize_account(updated_account)


@console_ns.route("/account/interface-theme")
class AccountInterfaceThemeApi(Resource):
    @console_ns.expect(console_ns.models[AccountInterfaceThemePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = AccountInterfaceThemePayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, interface_theme=args.interface_theme)

        return _serialize_account(updated_account)


@console_ns.route("/account/timezone")
class AccountTimezoneApi(Resource):
    @console_ns.expect(console_ns.models[AccountTimezonePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = AccountTimezonePayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, timezone=args.timezone)

        return _serialize_account(updated_account)


@console_ns.route("/account/password")
class AccountPasswordApi(Resource):
    @console_ns.expect(console_ns.models[AccountPasswordPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = AccountPasswordPayload.model_validate(payload)

        try:
            AccountService.update_account_password(current_user, args.password, args.new_password)
        except ServiceCurrentPasswordIncorrectError:
            raise CurrentPasswordIncorrectError()

        return _serialize_account(current_user)


@console_ns.route("/account/integrates")
class AccountIntegrateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountIntegrateListResponse.__name__])
    @with_current_user
    def get(self, account: Account):
        account_integrates = db.session.scalars(
            select(AccountIntegrate).where(AccountIntegrate.account_id == account.id)
        ).all()

        base_url = request.url_root.rstrip("/")
        oauth_base_path = "/console/api/oauth/login"
        providers = ["github", "google"]

        integrate_data = []
        for provider in providers:
            existing_integrate = next((ai for ai in account_integrates if ai.provider == provider), None)
            if existing_integrate:
                integrate_data.append(
                    {
                        "id": existing_integrate.id,
                        "provider": provider,
                        "created_at": existing_integrate.created_at,
                        "is_bound": True,
                        "link": None,
                    }
                )
            else:
                integrate_data.append(
                    {
                        "id": None,
                        "provider": provider,
                        "created_at": None,
                        "is_bound": False,
                        "link": f"{base_url}{oauth_base_path}/{provider}",
                    }
                )

        return AccountIntegrateListResponse(
            data=[AccountIntegrateResponse.model_validate(item) for item in integrate_data]
        ).model_dump(mode="json")


@console_ns.route("/account/delete/verify")
class AccountDeleteVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @with_current_user
    def get(self, account: Account):
        token, code = AccountService.generate_account_deletion_verification_code(account)
        AccountService.send_account_deletion_verification_email(account, code)

        return {"result": "success", "data": token}


@console_ns.route("/account/delete")
class AccountDeleteApi(Resource):
    @console_ns.expect(console_ns.models[AccountDeletePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, account: Account):
        payload = console_ns.payload or {}
        args = AccountDeletePayload.model_validate(payload)

        if not AccountService.verify_account_deletion_code(args.token, args.code):
            raise InvalidAccountDeletionCodeError()

        AccountService.delete_account(account)

        return {"result": "success"}


@console_ns.route("/account/delete/feedback")
class AccountDeleteUpdateFeedbackApi(Resource):
    @console_ns.expect(console_ns.models[AccountDeletionFeedbackPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    def post(self):
        payload = console_ns.payload or {}
        args = AccountDeletionFeedbackPayload.model_validate(payload)

        BillingService.update_account_deletion_feedback(args.email, args.feedback)

        return {"result": "success"}


@console_ns.route("/account/education/verify")
class EducationVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @console_ns.response(200, "Success", console_ns.models[EducationVerifyResponse.__name__])
    @with_current_user
    def get(self, account: Account):
        return EducationVerifyResponse.model_validate(
            BillingService.EducationIdentity.verify(account.id, account.email) or {}
        ).model_dump(mode="json")


@console_ns.route("/account/education")
class EducationApi(Resource):
    @console_ns.expect(console_ns.models[EducationActivatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[EducationActivateResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @with_current_user
    def post(self, account: Account):
        payload = console_ns.payload or {}
        args = EducationActivatePayload.model_validate(payload)

        return BillingService.EducationIdentity.activate(account, args.token, args.institution, args.role)

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @console_ns.response(200, "Success", console_ns.models[EducationStatusResponse.__name__])
    @with_current_user
    def get(self, account: Account):
        res = BillingService.EducationIdentity.status(account.id) or {}
        # convert expire_at to UTC timestamp from isoformat
        if res and "expire_at" in res:
            res["expire_at"] = datetime.fromisoformat(res["expire_at"]).astimezone(pytz.utc)
        return EducationStatusResponse.model_validate(res).model_dump(mode="json")


@console_ns.route("/account/education/autocomplete")
class EducationAutoCompleteApi(Resource):
    @console_ns.doc(params=query_params_from_model(EducationAutocompleteQuery))
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @console_ns.response(200, "Success", console_ns.models[EducationAutocompleteResponse.__name__])
    def get(self):
        payload = request.args.to_dict(flat=True)
        args = EducationAutocompleteQuery.model_validate(payload)

        return EducationAutocompleteResponse.model_validate(
            BillingService.EducationIdentity.autocomplete(args.keywords, args.page, args.limit) or {}
        ).model_dump(mode="json")


@console_ns.route("/account/change-email")
class ChangeEmailSendEmailApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailSendPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
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
        return {"result": "success", "data": token}


@console_ns.route("/account/change-email/validity")
class ChangeEmailCheckApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailValidityPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[VerificationTokenResponse.__name__])
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
        return {"is_valid": True, "email": normalized_token_email, "token": new_token}


@console_ns.route("/account/change-email/reset")
class ChangeEmailResetApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailResetPayload.__name__])
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountResponse.__name__])
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = ChangeEmailResetPayload.model_validate(payload)
        normalized_new_email = args.new_email.lower()

        if AccountService.is_account_in_freeze(normalized_new_email):
            raise AccountInFreezeError()

        if not AccountService.check_email_unique(normalized_new_email):
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

        updated_account = AccountService.update_account_email(current_user, email=normalized_new_email)

        AccountService.send_change_email_completed_notify_email(
            email=normalized_new_email,
        )

        return _serialize_account(updated_account)


@console_ns.route("/account/change-email/check-email-unique")
class CheckEmailUnique(Resource):
    @console_ns.expect(console_ns.models[CheckEmailUniquePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    def post(self):
        payload = console_ns.payload or {}
        args = CheckEmailUniquePayload.model_validate(payload)
        normalized_email = args.email.lower()
        if AccountService.is_account_in_freeze(normalized_email):
            raise AccountInFreezeError()
        if not AccountService.check_email_unique(normalized_email):
            raise EmailAlreadyInUseError()
        return {"result": "success"}
