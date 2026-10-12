"""Account-authenticated Human Input v2 approval transport."""

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, JsonValue

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from core.db.session_factory import session_factory
from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import AccountId
from fields.base import ResponseModel
from libs.datetime_utils import to_utc_timestamp
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
)


class ConsoleHumanInputV2SubmitPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    inputs: dict[str, JsonValue]
    action: str


class ConsoleHumanInputV2SubmitResponse(ResponseModel):
    pass


class ConsoleHumanInputV2FormDefinitionResponse(ResponseModel):
    """Frozen form definition and effective expiration in UTC epoch seconds."""

    resolved_form: ResolvedForm
    expiration_time: int


register_schema_models(console_ns, ConsoleHumanInputV2SubmitPayload)
register_response_schema_models(
    console_ns, ConsoleHumanInputV2SubmitResponse, ConsoleHumanInputV2FormDefinitionResponse
)


@console_ns.route("/form/human-input/v2/<string:form_token>")
class ConsoleHumanInputV2FormApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @console_ns.doc(
        "get_console_human_input_v2_form",
        description="Read a frozen v2 form using the current Account's Contact authorization.",
        responses={401: "Login required", 404: "Form not found", 409: "Already submitted", 410: "Expired"},
    )
    @console_ns.response(200, "Form retrieved", console_ns.models[ConsoleHumanInputV2FormDefinitionResponse.__name__])
    def get(self, current_user: Account, form_token: str):
        service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
        try:
            form = service.get_console_form(account_id=AccountId(current_user.id), form_token=form_token)
        except HumanInputFormError as exc:
            status = {
                HumanInputFormErrorCode.NOT_FOUND: 404,
                HumanInputFormErrorCode.ALREADY_SUBMITTED: 409,
                HumanInputFormErrorCode.EXPIRED: 410,
            }[exc.code]
            return {"code": exc.code.value, "message": "The form could not be retrieved."}, status
        return dump_response(
            ConsoleHumanInputV2FormDefinitionResponse,
            {
                "resolved_form": form.resolved_form,
                "expiration_time": to_utc_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
            },
        )

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
        except HumanInputFormError as exc:
            status = {
                HumanInputFormErrorCode.NOT_FOUND: 404,
                HumanInputFormErrorCode.ALREADY_SUBMITTED: 409,
                HumanInputFormErrorCode.EXPIRED: 410,
                HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE: 409,
                HumanInputFormErrorCode.INVALID_INPUT: 400,
            }[exc.code]
            return {"code": exc.code.value, "message": "The approval could not be accepted."}, status
        return ConsoleHumanInputV2SubmitResponse().model_dump(mode="json")
