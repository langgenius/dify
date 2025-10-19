from datetime import datetime

import pytz
from flask import request
from flask_restx import Resource, fields, marshal_with, reqparse
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
from libs.helper import TimestampField, email, extract_remote_ip, timezone
from libs.login import current_account_with_tenant, login_required
from models import Account, AccountIntegrate, InvitationCode
from services.account_service import AccountService
from services.billing_service import BillingService
from services.errors.account import CurrentPasswordIncorrectError as ServiceCurrentPasswordIncorrectError


@console_ns.route("/account/init")
class AccountInitApi(Resource):
    @setup_required
    @login_required
    def post(self):
        account, _ = current_account_with_tenant()

        if account.status == "active":
            raise AccountAlreadyInitedError()

        parser = reqparse.RequestParser()

        if dify_config.EDITION == "CLOUD":
            parser.add_argument("invitation_code", type=str, location="json")
        parser.add_argument("interface_language", type=supported_language, required=True, location="json").add_argument(
            "timezone", type=timezone, required=True, location="json"
        )
        args = parser.parse_args()

        if dify_config.EDITION == "CLOUD":
            if not args["invitation_code"]:
                raise ValueError("invitation_code is required")

            # check invitation code
            invitation_code = (
                db.session.query(InvitationCode)
                .where(
                    InvitationCode.code == args["invitation_code"],
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

        account.interface_language = args["interface_language"]
        account.timezone = args["timezone"]
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
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument("name", type=str, required=True, location="json")
        args = parser.parse_args()

        # Validate account name length
        if len(args["name"]) < 3 or len(args["name"]) > 30:
            raise ValueError("Account name must be between 3 and 30 characters.")

        updated_account = AccountService.update_account(current_user, name=args["name"])

        return updated_account


@console_ns.route("/account/avatar")
class AccountAvatarApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument("avatar", type=str, required=True, location="json")
        args = parser.parse_args()

        updated_account = AccountService.update_account(current_user, avatar=args["avatar"])

        return updated_account


@console_ns.route("/account/interface-language")
class AccountInterfaceLanguageApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument(
            "interface_language", type=supported_language, required=True, location="json"
        )
        args = parser.parse_args()

        updated_account = AccountService.update_account(current_user, interface_language=args["interface_language"])

        return updated_account


@console_ns.route("/account/interface-theme")
class AccountInterfaceThemeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument(
            "interface_theme", type=str, choices=["light", "dark"], required=True, location="json"
        )
        args = parser.parse_args()

        updated_account = AccountService.update_account(current_user, interface_theme=args["interface_theme"])

        return updated_account


@console_ns.route("/account/timezone")
class AccountTimezoneApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument("timezone", type=str, required=True, location="json")
        args = parser.parse_args()

        # Validate timezone string, e.g. America/New_York, Asia/Shanghai
        if args["timezone"] not in pytz.all_timezones:
            raise ValueError("Invalid timezone string.")

        updated_account = AccountService.update_account(current_user, timezone=args["timezone"])

        return updated_account


@console_ns.route("/account/password")
class AccountPasswordApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("password", type=str, required=False, location="json")
            .add_argument("new_password", type=str, required=True, location="json")
            .add_argument("repeat_new_password", type=str, required=True, location="json")
        )
        args = parser.parse_args()

        if args["new_password"] != args["repeat_new_password"]:
            raise RepeatPasswordNotMatchError()

        try:
            AccountService.update_account_password(current_user, args["password"], args["new_password"])
        except ServiceCurrentPasswordIncorrectError:
            raise CurrentPasswordIncorrectError()

        return {"result": "success"}


@console_ns.route("/account/integrates")
class AccountIntegrateApi(Resource):
    integrate_fields = {
        "provider": fields.String,
        "created_at": TimestampField,
        "is_bound": fields.Boolean,
        "link": fields.String,
    }

    integrate_list_fields = {
        "data": fields.List(fields.Nested(integrate_fields)),
    }

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(integrate_list_fields)
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
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        account, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("token", type=str, required=True, location="json")
            .add_argument("code", type=str, required=True, location="json")
        )
        args = parser.parse_args()

        if not AccountService.verify_account_deletion_code(args["token"], args["code"]):
            raise InvalidAccountDeletionCodeError()

        AccountService.delete_account(account)

        return {"result": "success"}


@console_ns.route("/account/delete/feedback")
class AccountDeleteUpdateFeedbackApi(Resource):
    @setup_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=str, required=True, location="json")
            .add_argument("feedback", type=str, required=True, location="json")
        )
        args = parser.parse_args()

        BillingService.update_account_deletion_feedback(args["email"], args["feedback"])

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

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    def post(self):
        account, _ = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("token", type=str, required=True, location="json")
            .add_argument("institution", type=str, required=True, location="json")
            .add_argument("role", type=str, required=True, location="json")
        )
        args = parser.parse_args()

        return BillingService.EducationIdentity.activate(account, args["token"], args["institution"], args["role"])

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

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @marshal_with(data_fields)
    def get(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("keywords", type=str, required=True, location="args")
            .add_argument("page", type=int, required=False, location="args", default=0)
            .add_argument("limit", type=int, required=False, location="args", default=20)
        )
        args = parser.parse_args()

        return BillingService.EducationIdentity.autocomplete(args["keywords"], args["page"], args["limit"])


@console_ns.route("/account/change-email")
class ChangeEmailSendEmailApi(Resource):
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=email, required=True, location="json")
            .add_argument("language", type=str, required=False, location="json")
            .add_argument("phase", type=str, required=False, location="json")
            .add_argument("token", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        account = None
        user_email = args["email"]
        if args["phase"] is not None and args["phase"] == "new_email":
            if args["token"] is None:
                raise InvalidTokenError()

            reset_data = AccountService.get_change_email_data(args["token"])
            if reset_data is None:
                raise InvalidTokenError()
            user_email = reset_data.get("email", "")

            if user_email != current_user.email:
                raise InvalidEmailError()
        else:
            with Session(db.engine) as session:
                account = session.execute(select(Account).filter_by(email=args["email"])).scalar_one_or_none()
            if account is None:
                raise AccountNotFound()

        token = AccountService.send_change_email_email(
            account=account, email=args["email"], old_email=user_email, language=language, phase=args["phase"]
        )
        return {"result": "success", "data": token}


@console_ns.route("/account/change-email/validity")
class ChangeEmailCheckApi(Resource):
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=email, required=True, location="json")
            .add_argument("code", type=str, required=True, location="json")
            .add_argument("token", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        user_email = args["email"]

        is_change_email_error_rate_limit = AccountService.is_change_email_error_rate_limit(args["email"])
        if is_change_email_error_rate_limit:
            raise EmailChangeLimitError()

        token_data = AccountService.get_change_email_data(args["token"])
        if token_data is None:
            raise InvalidTokenError()

        if user_email != token_data.get("email"):
            raise InvalidEmailError()

        if args["code"] != token_data.get("code"):
            AccountService.add_change_email_error_rate_limit(args["email"])
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_change_email_token(args["token"])

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_change_email_token(
            user_email, code=args["code"], old_email=token_data.get("old_email"), additional_data={}
        )

        AccountService.reset_change_email_error_rate_limit(args["email"])
        return {"is_valid": True, "email": token_data.get("email"), "token": new_token}


@console_ns.route("/account/change-email/reset")
class ChangeEmailResetApi(Resource):
    @enable_change_email
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("new_email", type=email, required=True, location="json")
            .add_argument("token", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        if AccountService.is_account_in_freeze(args["new_email"]):
            raise AccountInFreezeError()

        if not AccountService.check_email_unique(args["new_email"]):
            raise EmailAlreadyInUseError()

        reset_data = AccountService.get_change_email_data(args["token"])
        if not reset_data:
            raise InvalidTokenError()

        AccountService.revoke_change_email_token(args["token"])

        old_email = reset_data.get("old_email", "")
        current_user, _ = current_account_with_tenant()
        if current_user.email != old_email:
            raise AccountNotFound()

        updated_account = AccountService.update_account_email(current_user, email=args["new_email"])

        AccountService.send_change_email_completed_notify_email(
            email=args["new_email"],
        )

        return updated_account


@console_ns.route("/account/change-email/check-email-unique")
class CheckEmailUnique(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser().add_argument("email", type=email, required=True, location="json")
        args = parser.parse_args()
        if AccountService.is_account_in_freeze(args["email"]):
            raise AccountInFreezeError()
        if not AccountService.check_email_unique(args["email"]):
            raise EmailAlreadyInUseError()
        return {"result": "success"}
