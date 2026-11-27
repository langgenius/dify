"""Enterprise account recovery through Dify's password and login-security policies."""

from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.fields import SimpleMessageResponse
from controllers.common.schema import register_response_schema_model, register_schema_model
from controllers.console.wraps import model_validate, setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_application_services import application_services
from services.account_errors import AccountNotFoundError, InvalidAccountPasswordError


class AccountPasswordResetPayload(BaseModel):
    new_password: str = Field(repr=False)


register_schema_model(inner_api_ns, AccountPasswordResetPayload)
register_response_schema_model(inner_api_ns, SimpleMessageResponse)


@inner_api_ns.route("/enterprise/accounts/<uuid:account_id>:resetPassword")
class EnterpriseAccountPasswordReset(Resource):
    @inner_api_ns.doc("enterprise_reset_account_password")
    @inner_api_ns.expect(inner_api_ns.models[AccountPasswordResetPayload.__name__])
    @inner_api_ns.response(200, "Password reset", inner_api_ns.models[SimpleMessageResponse.__name__])
    @inner_api_ns.response(400, "Invalid password", inner_api_ns.models[SimpleMessageResponse.__name__])
    @inner_api_ns.response(404, "Account not found", inner_api_ns.models[SimpleMessageResponse.__name__])
    @enterprise_inner_api_only
    @setup_required
    @model_validate(AccountPasswordResetPayload)
    def post(self, args: AccountPasswordResetPayload, account_id: UUID):
        """Reset an existing account's password after inner API authentication and setup.

        Dify validates and hashes the password, then clears login failures using
        the stored email. Missing accounts and invalid passwords leave credentials
        unchanged. Redis cleanup retains the service's best-effort policy.
        """
        lifecycle = application_services().accounts.lifecycle
        try:
            account = lifecycle.get_account_by_id(str(account_id))
            if account is None:
                raise AccountNotFoundError()
            lifecycle.reset_password(account.id, args.new_password, email=account.email.lower())
        except AccountNotFoundError:
            return SimpleMessageResponse(message="account not found").model_dump(mode="json"), 404
        except InvalidAccountPasswordError as error:
            return SimpleMessageResponse(message=str(error)).model_dump(mode="json"), 400

        return SimpleMessageResponse(message="success").model_dump(mode="json"), 200
