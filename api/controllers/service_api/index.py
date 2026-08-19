from flask_restx import Resource

from configs import dify_config
from controllers.common.schema import register_response_schema_models
from controllers.service_api import service_api_ns
from fields.base import ResponseModel


class IndexInfoResponse(ResponseModel):
    welcome: str
    api_version: str
    server_version: str


register_response_schema_models(service_api_ns, IndexInfoResponse)


@service_api_ns.route("/")
class IndexApi(Resource):
    @service_api_ns.response(200, "Success", service_api_ns.models[IndexInfoResponse.__name__])
    def get(self) -> dict[str, str]:
        return IndexInfoResponse(
            welcome="Dify OpenAPI",
            api_version="v1",
            server_version=dify_config.project.version,
        ).model_dump(mode="json")
