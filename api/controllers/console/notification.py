from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext


class DismissNotificationPayload(BaseModel):
    notification_id: str = Field(...)


class NotificationItemResponse(ResponseModel):
    notification_id: str | None = None
    frequency: str | None = None
    lang: str
    title: str
    subtitle: str
    body: str
    title_pic_url: str


class NotificationResponse(ResponseModel):
    should_show: bool
    notifications: list[NotificationItemResponse]


register_schema_models(console_ns, DismissNotificationPayload)
register_response_schema_models(console_ns, SimpleResultResponse, NotificationResponse)


@console_ns.route("/notification")
class NotificationApi(Resource):
    @console_ns.doc("get_notification")
    @console_ns.doc(
        description=(
            "Return the active in-product notification for the current user "
            "in their interface language (falls back to English if unavailable). "
            "The notification is NOT marked as seen here; call POST /notification/dismiss "
            "when the user explicitly closes the modal."
        ),
        responses={
            200: "Success — inspect should_show to decide whether to render the modal",
            401: "Unauthorized",
        },
    )
    @console_ns.response(200, "Success", console_ns.models[NotificationResponse.__name__])
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    def get(self, request_context: RequestContext):
        result = application_services().notifications.get_active(request_context)
        return dump_response(NotificationResponse, result), 200


@console_ns.route("/notification/dismiss")
class NotificationDismissApi(Resource):
    @console_ns.doc("dismiss_notification")
    @console_ns.doc(
        description="Mark a notification as dismissed for the current user.",
        responses={200: "Success", 401: "Unauthorized"},
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    @console_ns.expect(console_ns.models[DismissNotificationPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @model_validate(DismissNotificationPayload)
    def post(self, payload: DismissNotificationPayload, request_context: RequestContext):
        application_services().notifications.dismiss(request_context, payload.notification_id)
        return dump_response(SimpleResultResponse, {"result": "success"}), 200
