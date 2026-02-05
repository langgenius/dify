from uuid import UUID

from flask_restx import Resource

from controllers.service_api import service_api_ns
from controllers.service_api.end_user.error import EndUserNotFoundError
from controllers.service_api.wraps import validate_app_token
from fields.end_user_fields import EndUserDetail
from models.model import App
from services.end_user_service import EndUserService


@service_api_ns.route("/end-users/<uuid:end_user_id>")
class EndUserApi(Resource):
    """Resource for retrieving end user details by ID."""

    @service_api_ns.doc("get_end_user")
    @service_api_ns.doc(description="Get an end user by ID")
    @service_api_ns.doc(
        params={"end_user_id": "End user ID"},
        responses={
            200: "End user retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "End user not found",
        },
    )
    @validate_app_token
    def get(self, app_model: App, end_user_id: UUID):
        """Get end user detail.

        This endpoint is scoped to the current app token's tenant/app to prevent
        cross-tenant/app access when an end-user ID is known.
        """

        end_user = EndUserService.get_end_user_by_id(
            tenant_id=app_model.tenant_id, app_id=app_model.id, end_user_id=str(end_user_id)
        )
        if end_user is None:
            raise EndUserNotFoundError()

        return EndUserDetail.model_validate(end_user).model_dump(mode="json")
