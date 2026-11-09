"""Explicit Overview tests and temporary files; no remote work is submitted by Verify."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import Field
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, Gone, NotFound

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.external_agents.io_contracts import ExternalIOError, FileBlob, JsonValue, OutputField
from services.external_agents.runtime_contracts import RuntimeError as ExternalRuntimeError
from services.external_agents.runtime_contracts import WaitPolicy

from .external import _Payload, external_call, require_external_execution


class ExternalTestOutputField(_Payload):
    """Public six-type profile; internal JSON-schema aliases are not wire types."""

    name: str = Field(min_length=1, max_length=255)
    kind: Literal["string", "number", "boolean", "object", "array", "file"]
    required: bool = True
    children: tuple[ExternalTestOutputField, ...] = ()
    item: ExternalTestOutputField | None = None
    has_default: bool = False
    default: JsonValue = None

    def field(self) -> OutputField:
        return OutputField(
            name=self.name,
            kind=self.kind,
            required=self.required,
            children=tuple(child.field() for child in self.children),
            item=self.item.field() if self.item else None,
            has_default=self.has_default,
            default=self.default,
        )


class ExternalTestPayload(_Payload):
    page_session_id: str = Field(min_length=1, max_length=128)
    expected_generation: int = Field(ge=1)
    idempotency_key: str = Field(min_length=1, max_length=255)
    task_text: str
    input_lease_ids: tuple[str, ...] = ()
    outputs: tuple[ExternalTestOutputField, ...] = (ExternalTestOutputField(name="text", kind="string"),)
    policy: WaitPolicy = WaitPolicy()


class ExternalPasteLinkPayload(_Payload):
    page_session_id: str = Field(min_length=1, max_length=128)
    url: str = Field(min_length=1, max_length=8192, repr=False)
    filename: str = Field(min_length=1, max_length=255)
    media_type: str = Field(min_length=1, max_length=255)


class ExternalTestPagePayload(_Payload):
    page_session_id: str = Field(min_length=1, max_length=128)


class ExternalTestStatusResponse(ResponseModel):
    invocation_id: str
    state: str
    outputs: dict | None
    error_code: str | None
    error_message: str | None
    metadata: dict


class ExternalTestFileResponse(ResponseModel):
    lease_id: str
    file_id: str
    filename: str
    media_type: str
    size: int
    expires_at: datetime


class ExternalAgentCapabilitiesResponse(ResponseModel):
    enabled: bool
    protocol: str
    transport: str
    authentication: tuple[str, ...]
    input_file_modes: tuple[str, ...]
    limits: dict


register_schema_models(console_ns, ExternalTestPayload, ExternalPasteLinkPayload, ExternalTestPagePayload)
register_response_schema_models(
    console_ns, ExternalTestStatusResponse, ExternalTestFileResponse, ExternalAgentCapabilitiesResponse
)


def _call[T](operation: Callable[[], T]) -> T:
    try:
        return external_call(operation)
    except ExternalRuntimeError as error:
        if error.code in {"permission_denied", "execution_unavailable"}:
            raise Forbidden(str(error)) from None
        if error.code in {"invocation_not_found", "agent_not_found"}:
            raise NotFound(str(error)) from None
        if error.code in {"data_expired", "test_expired", "parent_deleted"}:
            raise Gone(str(error)) from None
        raise Conflict(str(error)) from None
    except ExternalIOError as error:
        raise BadRequest(str(error)) from None


@console_ns.route("/external-agents/capabilities")
class ExternalAgentCapabilitiesApi(Resource):
    @console_ns.response(
        200, "Authenticated effective profile", console_ns.models[ExternalAgentCapabilitiesResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext):
        return dump_response(ExternalAgentCapabilitiesResponse, application_services().external_agents.capabilities)


@console_ns.route("/external-agents/<uuid:agent_id>/tests")
class ExternalAgentTestApi(Resource):
    @console_ns.expect(console_ns.models[ExternalTestPayload.__name__])
    @console_ns.response(
        202, "Accepted explicit saved-configuration test", console_ns.models[ExternalTestStatusResponse.__name__]
    )
    @console_account_admission()
    def post(self, context: RequestContext, agent_id: UUID):
        require_external_execution()
        payload = ExternalTestPayload.model_validate(request.get_json())
        services = application_services().external_agents
        value = _call(
            lambda: services.tests.start(
                context,
                agent_id=str(agent_id),
                **payload.model_dump(exclude={"outputs", "policy"}),
                outputs=tuple(output.field() for output in payload.outputs),
                policy=payload.policy,
            )
        )
        services.enqueue()
        result = _call(lambda: services.tests.result(context, agent_id=str(agent_id), invocation_id=value.id))
        return dump_response(ExternalTestStatusResponse, asdict(result)), 202


@console_ns.route("/external-agents/<uuid:agent_id>/tests/<uuid:invocation_id>")
class ExternalAgentTestResultApi(Resource):
    @console_ns.response(200, "Current test result", console_ns.models[ExternalTestStatusResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext, agent_id: UUID, invocation_id: UUID):
        result = _call(
            lambda: application_services().external_agents.tests.result(
                context, agent_id=str(agent_id), invocation_id=str(invocation_id)
            )
        )
        return dump_response(ExternalTestStatusResponse, asdict(result))


@console_ns.route("/external-agents/<uuid:agent_id>/tests/<uuid:invocation_id>/cancel")
class ExternalAgentTestCancelApi(Resource):
    @console_account_admission()
    def post(self, context: RequestContext, agent_id: UUID, invocation_id: UUID):
        services = application_services().external_agents
        _call(lambda: services.tests.cancel(context, agent_id=str(agent_id), invocation_id=str(invocation_id)))
        services.enqueue()
        return {"result": "requested"}, 202


@console_ns.route("/external-agents/<uuid:agent_id>/test-files")
class ExternalAgentTestFileApi(Resource):
    @console_ns.response(201, "Temporary owned test input", console_ns.models[ExternalTestFileResponse.__name__])
    @console_account_admission()
    def post(self, context: RequestContext, agent_id: UUID):
        require_external_execution()
        if len(request.files) != 1 or "file" not in request.files:
            raise BadRequest("Exactly one file is required.")
        upload = request.files["file"]
        services = application_services().external_agents
        # Read at most the effective per-file cap plus one; never read unbounded request bodies.
        maximum = max(services.file_limits.max_document_bytes, services.file_limits.max_image_bytes)
        blob = FileBlob(
            filename=upload.filename or "", media_type=upload.mimetype, data=upload.stream.read(maximum + 1)
        )
        result = _call(
            lambda: services.tests.upload(
                context, agent_id=str(agent_id), page_session_id=request.form.get("page_session_id", ""), blob=blob
            )
        )
        return dump_response(ExternalTestFileResponse, asdict(result)), 201


@console_ns.route("/external-agents/<uuid:agent_id>/test-files/paste-link")
class ExternalAgentTestPasteLinkApi(Resource):
    @console_ns.expect(console_ns.models[ExternalPasteLinkPayload.__name__])
    @console_ns.response(201, "Fetched owned temporary copy", console_ns.models[ExternalTestFileResponse.__name__])
    @console_account_admission()
    def post(self, context: RequestContext, agent_id: UUID):
        require_external_execution()
        payload = ExternalPasteLinkPayload.model_validate(request.get_json())
        result = _call(
            lambda: application_services().external_agents.tests.paste_link(
                context, agent_id=str(agent_id), **payload.model_dump()
            )
        )
        return dump_response(ExternalTestFileResponse, asdict(result)), 201


@console_ns.route("/external-agents/<uuid:agent_id>/test-files/<uuid:lease_id>")
class ExternalAgentTestFileReleaseApi(Resource):
    @console_ns.response(204, "Owned unsubmitted input cleared; admitted input remains intact")
    @console_account_admission()
    def delete(self, context: RequestContext, agent_id: UUID, lease_id: UUID):
        _call(
            lambda: application_services().external_agents.tests.release_file(
                context,
                agent_id=str(agent_id),
                lease_id=str(lease_id),
            )
        )
        application_services().external_agents.enqueue()
        return "", 204


@console_ns.route("/external-agent-tests/leave-page")
class ExternalAgentTestLeaveApi(Resource):
    @console_ns.expect(console_ns.models[ExternalTestPagePayload.__name__])
    @console_account_admission()
    def post(self, context: RequestContext):
        payload = ExternalTestPagePayload.model_validate(request.get_json())
        application_services().external_agents.retention.leave_test_page(
            tenant_id=context.active_workspace_id,
            actor_id=context.account_id,
            page_session_id=payload.page_session_id,
            now=datetime.now(UTC),
        )
        return {"result": "success"}, 202
