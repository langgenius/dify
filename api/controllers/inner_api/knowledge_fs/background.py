"""Authenticated broker publication only; never accepts a command or document body."""

from http import HTTPStatus

from flask import Response, request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge, ServiceUnavailable

from controllers.common.schema import register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import knowledge_fs_inner_api_only
from services.knowledge_fs.background_contract import BackgroundJobPayload
from services.knowledge_fs.background_publisher import check_background_publisher_ready, publish_background_job

register_schema_models(inner_api_ns, BackgroundJobPayload)


@inner_api_ns.route("/knowledge-fs/background/jobs")
class KnowledgeFSBackgroundJobApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[BackgroundJobPayload.__name__])
    @inner_api_ns.response(202, "Accepted by the Celery broker")
    @knowledge_fs_inner_api_only
    def post(self) -> Response:
        request.max_content_length = 16_384
        if request.content_length is not None and request.content_length > 16_384:
            raise RequestEntityTooLarge("KnowledgeFS background locator is too large")
        try:
            job = BackgroundJobPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as error:
            raise BadRequest("Invalid KnowledgeFS background locator") from error
        try:
            publish_background_job(job)
        except ValueError as error:
            raise BadRequest("Invalid KnowledgeFS background schedule") from error
        except Exception as error:
            # A failed/uncertain publish must leave the durable outbox eligible for redelivery.
            raise ServiceUnavailable("KnowledgeFS Celery publication is unavailable") from error
        return Response(status=HTTPStatus.ACCEPTED)


@inner_api_ns.route("/knowledge-fs/background/health")
class KnowledgeFSBackgroundHealthApi(Resource):
    @knowledge_fs_inner_api_only
    def get(self) -> Response:
        try:
            check_background_publisher_ready()
        except Exception as error:
            raise ServiceUnavailable("KnowledgeFS Celery publication is unavailable") from error
        return Response(status=HTTPStatus.NO_CONTENT)
