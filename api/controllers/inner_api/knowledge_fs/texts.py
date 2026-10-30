"""Authenticated full-text bridge; provider configuration never comes from callers."""

import re
from contextlib import nullcontext
from uuid import uuid4

from flask import Response, after_this_request, request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, ServiceUnavailable

from configs import dify_config
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.knowledge_fs.vectors import VectorMatchResponse
from controllers.inner_api.wraps import knowledge_fs_inner_api_only
from fields.base import ResponseModel
from libs.helper import dump_response
from services.knowledge_fs.text_search_deadline import TextSearchDeadline
from services.knowledge_fs.text_store import (
    TextIndexPendingError,
    TextPayload,
    TextPoint,
    configured_text_client,
    execute_text_request,
)
from services.knowledge_fs.text_store_diagnostics import text_backend_diagnostics, text_backend_stage
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
        deadline_ms = None
        if payload.operation == "search":
            header = request.headers.get("X-Knowledge-FS-Deadline-Ms")
            if header is not None:
                if not re.fullmatch(r"[0-9]{1,16}", header) or not 0 < int(header) <= 2**53 - 1:
                    raise BadRequest("Invalid KnowledgeFS full-text deadline")
                deadline_ms = int(header)
        request_id = request.headers.get("X-Knowledge-FS-Request-Id", "")
        if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", request_id):
            request_id = str(uuid4())

        @after_this_request
        def attach_request_id(response: Response) -> Response:
            response.headers["X-Knowledge-FS-Request-Id"] = request_id
            return response

        with text_backend_diagnostics(request_id, payload, dify_config.VECTOR_STORE or "unconfigured") as diagnostics:
            try:
                with text_backend_stage("deadline"):
                    deadline = TextSearchDeadline.from_epoch_ms(deadline_ms) if payload.operation == "search" else None
                with (
                    deadline.enforce() if deadline else nullcontext(),
                    text_backend_stage("configure"),
                    configured_text_client(
                        payload.scope.tenant_id,
                        allow_create=payload.operation == "upsert",
                        **({"deadline": deadline} if deadline else {}),
                    ) as client,
                ):
                    result = execute_text_request(client, payload)
            except (TidbBindingPendingError, TextIndexPendingError) as error:
                diagnostics.log_failure(error, outcome="pending")
                raise ServiceUnavailable("KnowledgeFS full-text index is being initialized", retry_after=5) from None
            except Exception as error:
                diagnostics.log_failure(error, outcome="failed")
                raise ServiceUnavailable("KnowledgeFS full-text backend is unavailable") from None
        return dump_response(TextResponse, result)
