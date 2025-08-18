from flask import request
from flask_restful import Resource, reqparse

from controllers.service_api import api
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.helper.trace_id_helper import get_external_trace_id
from services.app_trigger_service import AppTriggerService


class TriggerApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("workflow_id", type=str, required=True, location="json")
        parser.add_argument("payload", type=dict, required=True, location="json")
        args = parser.parse_args()

        external_trace_id = get_external_trace_id(request)
        if external_trace_id:
            args["external_trace_id"] = external_trace_id

        app_id = args["app_id"]
        payload = args["payload"]

        # todo: create trigger task for worker handler
        AppTriggerService.create_app_trigger_task(app_id=args["app_id"], payload=payload)

        return {"status": "success", "app_id": app_id, "data": payload}, 200


api.add_resource(TriggerApi, "/chat-messages")
