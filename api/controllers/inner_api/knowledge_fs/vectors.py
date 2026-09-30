"""Authenticated vector bridge; only the server's configured backend is reachable."""

from flask import request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, ServiceUnavailable

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import knowledge_fs_inner_api_only
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.helper import dump_response
from services.knowledge_fs.vector_store import (
    VectorPoint,
    VectorRequest,
    admit_vector_request,
    configured_vector_client,
    execute_vector_request,
)
from services.tidb_binding_service import TidbBindingPendingError
from services.vector_space_admission_service import VectorSpaceAdmissionError, VectorSpaceAdmissionUnavailableError


class KnowledgeFSVectorQuotaExceededError(BaseHTTPException):
    error_code = "vector_space_quota_exceeded"
    code = 413


class KnowledgeFSVectorQuotaUnavailableError(BaseHTTPException):
    error_code = "vector_space_quota_unavailable"
    code = 503


class VectorMatchResponse(ResponseModel):
    id: str
    score: float


class VectorResponse(ResponseModel):
    points: list[VectorPoint]
    matches: list[VectorMatchResponse]


register_schema_models(inner_api_ns, VectorRequest)
register_response_schema_models(inner_api_ns, VectorResponse)


@inner_api_ns.route("/knowledge-fs/vectors")
class KnowledgeFSVectorApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[VectorRequest.__name__])
    @inner_api_ns.response(200, "Vector operation completed", inner_api_ns.models[VectorResponse.__name__])
    @knowledge_fs_inner_api_only
    def post(self) -> dict[str, object]:
        request.max_content_length = 32 * 1024 * 1024
        try:
            payload = VectorRequest.model_validate(inner_api_ns.payload or {})
        except ValidationError as error:
            raise BadRequest("Invalid KnowledgeFS vector operation") from error
        try:
            admit_vector_request(payload)
            with configured_vector_client(
                payload.scope.tenant_id, allow_create=payload.operation == "upsert"
            ) as client:
                result = execute_vector_request(client, payload, check_admission=False)
        except TidbBindingPendingError:
            raise ServiceUnavailable("KnowledgeFS vector backend is being provisioned", retry_after=5) from None
        except VectorSpaceAdmissionUnavailableError as error:
            raise KnowledgeFSVectorQuotaUnavailableError(str(error)) from None
        except VectorSpaceAdmissionError as error:
            raise KnowledgeFSVectorQuotaExceededError(str(error)) from None
        except Exception:
            # Native SDK exceptions can contain endpoint credentials or vectors.
            raise ServiceUnavailable("KnowledgeFS vector backend is unavailable") from None
        return dump_response(VectorResponse, result)
