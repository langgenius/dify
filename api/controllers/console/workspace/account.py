import datetime

import pytz
from flask import request
from flask_login import current_user
from flask_restful import Resource, fields, marshal_with, reqparse

from configs import dify_config
from constants.languages import supported_language
from controllers.console import api
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
    enterprise_license_required,
    only_edition_cloud,
    setup_required,
)
from extensions.ext_database import db
from fields.member_fields import account_fields
from libs.helper import TimestampField, timezone
from libs.login import login_required
from models import AccountIntegrate, InvitationCode
from services.account_service import AccountService
from services.billing_service import BillingService
from services.errors.account import CurrentPasswordIncorrectError as ServiceCurrentPasswordIncorrectError


class AccountInitApi(Resource):
    @setup_required
    @login_required
    def post(self):
        account = current_user

        if account.status == "active":
            raise AccountAlreadyInitedError()

        parser = reqparse.RequestParser()

        if dify_config.EDITION == "CLOUD":
            parser.add_argument("invitation_code", type=str, location="json")

        parser.add_argument("interface_language", type=supported_language, required=True, location="json")
        parser.add_argument("timezone", type=timezone, required=True, location="json")
        args = parser.parse_args()

        if dify_config.EDITION == "CLOUD":
            if not args["invitation_code"]:
                raise ValueError("invitation_code is required")

            # check invitation code
            invitation_code = (
                db.session.query(InvitationCode)
                .filter(
                    InvitationCode.code == args["invitation_code"],
                    InvitationCode.status == "unused",
                )
                .first()
            )

            if not invitation_code:
                raise InvalidInvitationCodeError()

            invitation_code.status = "used"
            invitation_code.used_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            invitation_code.used_by_tenant_id = account.current_tenant_id
            invitation_code.used_by_account_id = account.id

        account.interface_language = args["interface_language"]
        account.timezone = args["timezone"]
        account.interface_theme = "light"
        account.status = "active"
        account.initialized_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        db.session.commit()

        return {"result": "success"}


class AccountProfileApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    @enterprise_license_required
    def get(self):
        return current_user


class AccountNameApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        args = parser.parse_args()

        # Validate account name length
        if len(args["name"]) < 3 or len(args["name"]) > 30:
            raise ValueError("Account name must be between 3 and 30 characters.")

        updated_account = AccountService.update_account(current_user, name=args["name"])

        return updated_account


class AccountAvatarApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("avatar", type=str, required=True, location="json")
        args = parser.parse_args()

        updated_account = AccountService.update_account(current_user, avatar=args["avatar"])

        return updated_account


class AccountInterfaceLanguageApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("interface_language", type=supported_language, required=True, location="json")
        args = parser.parse_args()

        updated_account = AccountService.update_account(current_user, interface_language=args["interface_language"])

        return updated_account


class AccountInterfaceThemeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("interface_theme", type=str, choices=["light", "dark"], required=True, location="json")
        args = parser.parse_args()

        updated_account = AccountService.update_account(current_user, interface_theme=args["interface_theme"])

        return updated_account


class AccountTimezoneApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("timezone", type=str, required=True, location="json")
        args = parser.parse_args()

        # Validate timezone string, e.g. America/New_York, Asia/Shanghai
        if args["timezone"] not in pytz.all_timezones:
            raise ValueError("Invalid timezone string.")

        updated_account = AccountService.update_account(current_user, timezone=args["timezone"])

        return updated_account


class AccountPasswordApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_fields)
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("password", type=str, required=False, location="json")
        parser.add_argument("new_password", type=str, required=True, location="json")
        parser.add_argument("repeat_new_password", type=str, required=True, location="json")
        args = parser.parse_args()

        if args["new_password"] != args["repeat_new_password"]:
            raise RepeatPasswordNotMatchError()

        try:
            AccountService.update_account_password(current_user, args["password"], args["new_password"])
        except ServiceCurrentPasswordIncorrectError:
            raise CurrentPasswordIncorrectError()

        return {"result": "success"}


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
        account = current_user

        account_integrates = db.session.query(AccountIntegrate).filter(AccountIntegrate.account_id == account.id).all()

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


class AccountDeleteVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        account = current_user

        token, code = AccountService.generate_account_deletion_verification_code(account)
        AccountService.send_account_deletion_verification_email(account, code)

        return {"result": "success", "data": token}


class AccountDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("token", type=str, required=True, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        args = parser.parse_args()

        if not AccountService.verify_account_deletion_code(args["token"], args["code"]):
            raise InvalidAccountDeletionCodeError()

        AccountService.delete_account(account)

        return {"result": "success"}


class AccountDeleteUpdateFeedbackApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument("feedback", type=str, required=True, location="json")
        args = parser.parse_args()

        BillingService.update_account_deletion_feedback(args["email"], args["feedback"])

        return {"result": "success"}


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
        account = current_user

        return BillingService.EducationIdentity.verify(account.id, account.email)


class EducationApi(Resource):
    status_fields = {
        "result": fields.Boolean,
    }

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    def post(self):
        account = current_user

        parser = reqparse.RequestParser()
        parser.add_argument("token", type=str, required=True, location="json")
        parser.add_argument("institution", type=str, required=True, location="json")
        parser.add_argument("role", type=str, required=True, location="json")
        args = parser.parse_args()

        return BillingService.EducationIdentity.activate(account, args["token"], args["institution"], args["role"])

    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @cloud_edition_billing_enabled
    @marshal_with(status_fields)
    def get(self):
        account = current_user

        return BillingService.EducationIdentity.is_active(account.id)


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
        parser = reqparse.RequestParser()
        parser.add_argument("keywords", type=str, required=True, location="args")
        parser.add_argument("page", type=int, required=False, location="args", default=0)
        parser.add_argument("limit", type=int, required=False, location="args", default=20)
        args = parser.parse_args()

        return BillingService.EducationIdentity.autocomplete(args["keywords"], args["page"], args["limit"])


# Register API resources
api.add_resource(AccountInitApi, "/account/init")
api.add_resource(AccountProfileApi, "/account/profile")
api.add_resource(AccountNameApi, "/account/name")
api.add_resource(AccountAvatarApi, "/account/avatar")
api.add_resource(AccountInterfaceLanguageApi, "/account/interface-language")
api.add_resource(AccountInterfaceThemeApi, "/account/interface-theme")
api.add_resource(AccountTimezoneApi, "/account/timezone")
api.add_resource(AccountPasswordApi, "/account/password")
api.add_resource(AccountIntegrateApi, "/account/integrates")
api.add_resource(AccountDeleteVerifyApi, "/account/delete/verify")
api.add_resource(AccountDeleteApi, "/account/delete")
api.add_resource(AccountDeleteUpdateFeedbackApi, "/account/delete/feedback")
api.add_resource(EducationVerifyApi, "/account/education/verify")
api.add_resource(EducationApi, "/account/education")
api.add_resource(EducationAutoCompleteApi, "/account/education/autocomplete")
# api.add_resource(AccountEmailApi, '/account/email')
# api.add_resource(AccountEmailVerifyApi, '/account/email-verify')
