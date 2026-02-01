from __future__ import annotations

from datetime import datetime
from typing import Literal

import pytz
from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from constants.languages import supported_language
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
)
from extensions.ext_database import db
from fields.member_fields import account_fields
from libs.datetime_utils import naive_utc_now
from libs.helper import EmailStr, TimestampField, extract_remote_ip, timezone
from libs.login import current_account_with_tenant, login_required
from models import AccountIntegrate, InvitationCode
from services.account_service import AccountService
from services.billing_service import BillingService
from services.errors.account import CurrentPasswordIncorrectError as ServiceCurrentPasswordIncorrectError

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


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


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(AccountInitPayload)
reg(AccountNamePayload)
reg(AccountAvatarPayload)
reg(AccountInterfaceLanguagePayload)
reg(AccountInterfaceThemePayload)
reg(AccountTimezonePayload)
reg(AccountPasswordPayload)
reg(AccountDeletePayload)
reg(AccountDeletionFeedbackPayload)
reg(EducationActivatePayload)
reg(EducationAutocompleteQuery)
reg(ChangeEmailSendPayload)
reg(ChangeEmailValidityPayload)
reg(ChangeEmailResetPayload)
reg(CheckEmailUniquePayload)

integrate_fields = {
    "provider": fields.String,
    "created_at": TimestampField,
    "is_bound": fields.Boolean,
    "link": fields.String,
}

integrate_model = console_ns.model("AccountIntegrate", integrate_fields)
integrate_list_model = console_ns.model(
    "AccountIntegrateList",
    {"data": fields.List(fields.Nested(integrate_model))},
)


@console_ns.route("/account/init")
class AccountInitApi(Resource):
    @console_ns.expect(console_ns.models[AccountInitPayload.__name__])
    @setup_required
    @login_required
    def post(self):
        account, _ = current_account_with_tenant()

        if account.status == "active":
            raise AccountAlreadyInitedError()

        payload = console_ns.payload or {}
        args = AccountInitPayload.model_validate(payload)

        if dify_config.EDITION == "CLOUD":
            if not args.invitation_code:
                raise ValueError("invitation_code is required")

            # check invitation code
            invitation_code = (
                db.session.query(InvitationCode)
                .where(
                    InvitationCode.code == args.invitation_code,
                    InvitationCode.status == "unused",
                )
                .first()
            )

            if not invitation_code:
                raise InvalidInvitationCodeError()

            invitation_code.status = "used"
            invitation_code.used_at = naive_utc_now()
            invitation_code.used_by_tenant_id = account.current_tenant_id
            invitation_code.used_by_account_id = account.id

        account.interface_language = args.interface_language
        account.timezone = args.timezone
        account.interface_theme = "light"
        account.status = "active"
        account.initialized_at = naive_utc_now()
        db.session.commit()

        return {"result": "success"}


@console_ns.route("/account/profile")
class AccountProfileApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    @enterprise_license_required
    def get(self):
        current_user, _ = current_account_with_tenant()
        return current_user


@console_ns.route("/account/name")
class AccountNameApi(Resource):
    @console_ns.expect(console_ns.models[AccountNamePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = AccountNamePayload.model_validate(payload)
        updated_account = AccountService.update_account(current_user, name=args.name)

        return updated_account


@console_ns.route("/account/avatar")
class AccountAvatarApi(Resource):
    @console_ns.expect(console_ns.models[AccountAvatarPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = AccountAvatarPayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, avatar=args.avatar)

        return updated_account


@console_ns.route("/account/interface-language")
class AccountInterfaceLanguageApi(Resource):
    @console_ns.expect(console_ns.models[AccountInterfaceLanguagePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = AccountInterfaceLanguagePayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, interface_language=args.interface_language)

        return updated_account


@console_ns.route("/account/interface-theme")
class AccountInterfaceThemeApi(Resource):
    @console_ns.expect(console_ns.models[AccountInterfaceThemePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = AccountInterfaceThemePayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, interface_theme=args.interface_theme)

        return updated_account


@console_ns.route("/account/timezone")
class AccountTimezoneApi(Resource):
    @console_ns.expect(console_ns.models[AccountTimezonePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = AccountTimezonePayload.model_validate(payload)

        updated_account = AccountService.update_account(current_user, timezone=args.timezone)

        return updated_account


@console_ns.route("/account/password")
class AccountPasswordApi(Resource):
    @console_ns.expect(console_ns.models[AccountPasswordPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = AccountPasswordPayload.model_validate(payload)

        try:
            AccountService.update_account_password(current_user, args.password, args.new_password)
        except ServiceCurrentPasswordIncorrectError:
            raise CurrentPasswordIncorrectError()

        return {"result": "success"}


@console_ns.route("/account/integrates")
class AccountIntegrateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(integrate_list_model)
    def get(self):
        account, _ = current_account_with_tenant()

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

        return {"data": integrate_data}


@console_ns.route("/account/delete/verify")
class AccountDeleteVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        account, _ = current_account_with_tenant()

        token, code = AccountService.generate_account_deletion_verification_code(account)
        AccountService.send_account_deletion_verification_email(account, code)

        return {"result": "success", "data": token}


@console_ns.route("/account/delete")
class AccountDeleteApi(Resource):
    @console_ns.expect(console_ns.models[AccountDeletePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        account, _ = current_account_with_tenant()

        payload = console_ns.payload or {}
        args = AccountDeletePayload.model_validate(payload)

        if not AccountService.verify_account_deletion_code(args.token, args.code):
            raise InvalidAccountDeletionCodeError()

        AccountService.delete_account(account)

        return {"result": "success"}


@console_ns.route("/account/delete/feedback")
class AccountDeleteUpdateFeedbackApi(Resource):
    @console_ns.expect(console_ns.models[AccountDeletionFeedbackPayload.__name__])
    @setup_required
    def post(self):
        payload = console_ns.payload or {}
        args = AccountDeletionFeedbackPayload.model_validate(payload)

        BillingService.update_account_deletion_feedback(args.email, args.feedback)

        return {"result": "success"}


@console_ns.route("/account/education/verify")
class EducationVerifyApi(Resource):
    verify_fields = {
        "token": fields.String,
    }

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @marshal_with(verify_fields)
    def get(self):
        account, _ = current_account_with_tenant()

        return BillingService.EducationIdentity.verify(account.id, account.email)


@console_ns.route("/account/education")
class EducationApi(Resource):
    status_fields = {
        "result": fields.Boolean,
        "is_student": fields.Boolean,
        "expire_at": TimestampField,
        "allow_refresh": fields.Boolean,
    }

    @console_ns.expect(console_ns.models[EducationActivatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    def post(self):
        account, _ = current_account_with_tenant()

        payload = console_ns.payload or {}
        args = EducationActivatePayload.model_validate(payload)

        return BillingService.EducationIdentity.activate(account, args.token, args.institution, args.role)

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @marshal_with(status_fields)
    def get(self):
        account, _ = current_account_with_tenant()

        res = BillingService.EducationIdentity.status(account.id)
        # convert expire_at to UTC timestamp from isoformat
        if res and "expire_at" in res:
            res["expire_at"] = datetime.fromisoformat(res["expire_at"]).astimezone(pytz.utc)
        return res


@console_ns.route("/account/education/autocomplete")
class EducationAutoCompleteApi(Resource):
    data_fields = {
        "data": fields.List(fields.String),
        "curr_page": fields.Integer,
        "has_next": fields.Boolean,
    }

    @console_ns.expect(console_ns.models[EducationAutocompleteQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @marshal_with(data_fields)
    def get(self):
        payload = request.args.to_dict(flat=True)  # type: ignore
        args = EducationAutocompleteQuery.model_validate(payload)

        return BillingService.EducationIdentity.autocomplete(args.keywords, args.page, args.limit)


@console_ns.route("/account/change-email")
class ChangeEmailSendEmailApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailSendPayload.__name__])
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = ChangeEmailSendPayload.model_validate(payload)

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if args.language is not None and args.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        account = None
        user_email = None
        email_for_sending = args.email.lower()
        if args.phase is not None and args.phase == "new_email":
            if args.token is None:
                raise InvalidTokenError()

            reset_data = AccountService.get_change_email_data(args.token)
            if reset_data is None:
                raise InvalidTokenError()
            user_email = reset_data.get("email", "")

            if user_email.lower() != current_user.email.lower():
                raise InvalidEmailError()

            user_email = current_user.email
        else:
            with Session(db.engine) as session:
                account = AccountService.get_account_by_email_with_case_fallback(args.email, session=session)
            if account is None:
                raise AccountNotFound()
            email_for_sending = account.email
            user_email = account.email

        token = AccountService.send_change_email_email(
            account=account,
            email=email_for_sending,
            old_email=user_email,
            language=language,
            phase=args.phase,
        )
        return {"result": "success", "data": token}


@console_ns.route("/account/change-email/validity")
class ChangeEmailCheckApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailValidityPayload.__name__])
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = console_ns.payload or {}
        args = ChangeEmailValidityPayload.model_validate(payload)

        user_email = args.email.lower()

        is_change_email_error_rate_limit = AccountService.is_change_email_error_rate_limit(user_email)
        if is_change_email_error_rate_limit:
            raise EmailChangeLimitError()

        token_data = AccountService.get_change_email_data(args.token)
        if token_data is None:
            raise InvalidTokenError()

        token_email = token_data.get("email")
        normalized_token_email = token_email.lower() if isinstance(token_email, str) else token_email
        if user_email != normalized_token_email:
            raise InvalidEmailError()

        if args.code != token_data.get("code"):
            AccountService.add_change_email_error_rate_limit(user_email)
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_change_email_token(args.token)

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_change_email_token(
            user_email, code=args.code, old_email=token_data.get("old_email"), additional_data={}
        )

        AccountService.reset_change_email_error_rate_limit(user_email)
        return {"is_valid": True, "email": normalized_token_email, "token": new_token}


@console_ns.route("/account/change-email/reset")
class ChangeEmailResetApi(Resource):
    @console_ns.expect(console_ns.models[ChangeEmailResetPayload.__name__])
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
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

        AccountService.revoke_change_email_token(args.token)

        old_email = reset_data.get("old_email", "")
        current_user, _ = current_account_with_tenant()
        if current_user.email.lower() != old_email.lower():
            raise AccountNotFound()

        updated_account = AccountService.update_account_email(current_user, email=normalized_new_email)

        AccountService.send_change_email_completed_notify_email(
            email=normalized_new_email,
        )

        return updated_account


@console_ns.route("/account/change-email/check-email-unique")
class CheckEmailUnique(Resource):
    @console_ns.expect(console_ns.models[CheckEmailUniquePayload.__name__])
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
