from flask import request
from flask_restful import Resource, reqparse  # type: ignore

from configs import dify_config
from constants.languages import languages
from controllers.service_api import api
from controllers.service_api.error import (
    AccountBannedError,
    AccountInFreezeError,
    EmailSendIpLimitError,
    NotAllowedCreateWorkspace,
)
from events.tenant_event import tenant_was_created
from libs.helper import email, extract_remote_ip
from libs.password import valid_password
from services.account_service import AccountService, TenantService
from services.billing_service import BillingService
from services.errors.account import AccountRegisterError
from services.errors.workspace import WorkSpaceNotAllowedCreateError
from services.feature_service import FeatureService


class SignupApi(Resource):
    def post(self):
        """User Signup API endpoint
        This endpoint handles new user registration.
        ---
        parameters:
          - name: body
            in: body
            required: true
            schema:
              $ref: '#/definitions/SignupRequest'
        definitions:
          SignupRequest:
            type: object
            required:
              - email
              - password
              - name
            properties:
              email:
                type: string
                format: email
                example: user@example.com
              password:
                type: string
                format: password
                example: StrongP@ssw0rd
              name:
                type: string
                example: John Doe
              language:
                type: string
                default: en-US
                example: en-US
          TokenPair:
            type: object
            properties:
              access_token:
                type: string
              refresh_token:
                type: string
        responses:
          200:
            description: Successfully registered and logged in
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
                data:
                  $ref: '#/definitions/TokenPair'
          400:
            description: Registration failed due to validation errors
          403:
            description: Registration not allowed or account banned
        """
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("password", type=valid_password, required=True, location="json")
        parser.add_argument("name", type=str, required=True, location="json")
        parser.add_argument("language", type=str, required=False, default="en-US", location="json")
        args = parser.parse_args()

        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(args["email"]):
            raise AccountInFreezeError()

        if not FeatureService.get_system_features().is_allow_register:
            raise NotAllowedCreateWorkspace()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        try:
            # Create account and tenant
            account = AccountService.create_account_and_tenant(
                email=args["email"],
                name=args["name"],
                password=args["password"],
                interface_language=args["language"] if args["language"] in languages else languages[0]
            )

            # Create default tenant
            tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
            TenantService.create_tenant_member(tenant, account, role="owner")
            account.current_tenant = tenant
            tenant_was_created.send(tenant)

            # Login the user
            token_pair = AccountService.login(account=account, ip_address=ip_address)
            return {"result": "success", "data": token_pair.model_dump()}

        except WorkSpaceNotAllowedCreateError:
            raise NotAllowedCreateWorkspace()
        except AccountRegisterError:
            raise AccountBannedError()


api.add_resource(SignupApi, "/signup")