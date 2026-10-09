"""Account-authenticated Human Input v2 approval transport."""

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, JsonValue

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from core.db.session_factory import session_factory
from core.human_input_v2.shared.values import AccountId
from fields.base import ResponseModel
from libs.login import login_required
from models.account import Account
from services.human_input_v2.submission_service import (
    ConsoleFormError,
    ConsoleFormErrorCode,
    HumanInputSubmissionService,
)


class ConsoleHumanInputV2SubmitPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    inputs: dict[str, JsonValue]
    action: str


class ConsoleHumanInputV2SubmitResponse(ResponseModel):
    pass


register_schema_models(console_ns, ConsoleHumanInputV2SubmitPayload)
register_response_schema_models(console_ns, ConsoleHumanInputV2SubmitResponse)


@console_ns.route("/form/human-input/v2/<string:form_token>")
class ConsoleHumanInputV2FormApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @console_ns.expect(console_ns.models[ConsoleHumanInputV2SubmitPayload.__name__])
    @console_ns.response(200, "Approval accepted", console_ns.models[ConsoleHumanInputV2SubmitResponse.__name__])
    def post(self, current_user: Account, form_token: str):
        payload = ConsoleHumanInputV2SubmitPayload.model_validate(console_ns.payload or {})
        service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
        try:
            service.submit_console_form(
                account_id=AccountId(current_user.id),
                form_token=form_token,
                action=payload.action,
                inputs=payload.inputs,
            )
        except ConsoleFormError as exc:
            status = {
                ConsoleFormErrorCode.NOT_FOUND: 404,
                ConsoleFormErrorCode.ALREADY_SUBMITTED: 409,
                ConsoleFormErrorCode.EXPIRED: 410,
                ConsoleFormErrorCode.WORKFLOW_NOT_ACTIVE: 409,
                ConsoleFormErrorCode.INVALID_INPUT: 400,
            }[exc.code]
            return {"code": exc.code.value, "message": "The approval could not be accepted."}, status
        return ConsoleHumanInputV2SubmitResponse().model_dump(mode="json")
