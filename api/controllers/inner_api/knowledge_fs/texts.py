"""Authenticated full-text bridge; provider configuration never comes from callers."""

from flask import request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, ServiceUnavailable

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.knowledge_fs.vectors import VectorMatchResponse
from controllers.inner_api.wraps import knowledge_fs_inner_api_only
from fields.base import ResponseModel
from libs.helper import dump_response
from services.knowledge_fs.text_store import (
    TextIndexPendingError,
    TextPayload,
    TextPoint,
    configured_text_client,
    execute_text_request,
)
from services.tidb_binding_service import TidbBindingPendingError


class TextResponse(ResponseModel):
    points: list[TextPoint]
    matches: list[VectorMatchResponse]


register_schema_models(inner_api_ns, TextPayload)
register_response_schema_models(inner_api_ns, TextResponse)


@inner_api_ns.route("/knowledge-fs/texts")
class KnowledgeFSTextApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[TextPayload.__name__])
    @inner_api_ns.response(200, "Full-text operation completed", inner_api_ns.models[TextResponse.__name__])
    @knowledge_fs_inner_api_only
    def post(self) -> dict[str, object]:
        request.max_content_length = 32 * 1024 * 1024
        try:
            payload = TextPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as error:
            raise BadRequest("Invalid KnowledgeFS full-text operation") from error
        try:
            with configured_text_client(payload.scope.tenant_id, allow_create=payload.operation == "upsert") as client:
                result = execute_text_request(client, payload)
        except (TidbBindingPendingError, TextIndexPendingError):
            raise ServiceUnavailable("KnowledgeFS full-text index is being initialized", retry_after=5) from None
        except Exception:
            raise ServiceUnavailable("KnowledgeFS full-text backend is unavailable") from None
        return dump_response(TextResponse, result)
