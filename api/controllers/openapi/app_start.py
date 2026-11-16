"""Start routes on /openapi/v1: begin a run as a background job and answer with its state."""

from __future__ import annotations

from typing import Final

from flask_restx import Resource

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import openapi_ns
from controllers.openapi._audit import emit_app_run
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._errors import JobCapacityReached, JobNotFound
from controllers.openapi._files import end_read_transaction
from controllers.openapi._models import (
    AdvancedChatStartPayload,
    JobState,
    WorkflowStartPayload,
)
from controllers.openapi.app_run import _RUN_GUARDS, _generate_args, _require_mode, _stream
from controllers.openapi.auth.context import Context
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_application_services import application_services
from models.model import AppMode
from services.run_job_contracts import JobOwner, OpenedJob
from services.run_job_service import JobCapacityError, JobNotFoundError, JobOpening, JobView, RunJobService

WORKFLOW_START_OP: Final = "start.console_app.workflow"
ADVANCED_CHAT_START_OP: Final = "start.console_app.advanced_chat"
_START_FIELDS: Final = frozenset({"wait_seconds", "idempotency_key"})
_JOB_STATE: Final = (200, JobState, "Job state")

type StartPayload = WorkflowStartPayload | AdvancedChatStartPayload


def _job_state(view: JobView) -> JobState:
    """Describe a job view; Task 5 replaces this with the hinted `job_state`."""
    record = view.record
    return JobState(
        id=record.id,
        status=view.status,
        run_id=record.run_id,
        message_id=record.message_id,
        conversation_id=record.conversation_id,
        answer=view.answer,
        outputs=dict(view.outputs) if view.outputs is not None else None,
        error=view.error,
    )


def _launch(ctx: Context, body: StartPayload, *, run_jobs: RunJobService, opened: OpenedJob, key: str | None) -> None:
    """Start the run behind a job this call created.

    Precondition: opened.created is true and attach was not called for it.
    Postcondition: the run's reader is attached; when the run cannot be generated, audited or attached, the job
    is discarded and the error propagates.
    """
    try:
        stream = _stream(ctx, _generate_args(ctx, body, exclude=_START_FIELDS), InvokeFrom.OPENAPI)
        emit_app_run(
            app_id=ctx.app.id,
            tenant_id=ctx.app.tenant_id,
            caller_kind=ctx.subject.caller_role,
            mode=str(ctx.app.mode),
            surface="apps",
        )
        run_jobs.attach(opened.record.id, stream)
    except BaseException:
        run_jobs.discard(opened, idempotency_key=key)
        raise


def start_job(ctx: Context, body: StartPayload, *, op: str, modes: tuple[AppMode, ...]) -> JobState:
    """Start a run as a background job and wait for its first result.

    Precondition: the guards admitted the caller and body is a start payload (wait_seconds, idempotency_key).
    Postcondition: a job exists and its run was accepted by the service, or the service's error was raised and no
    job remains. A repeated idempotency key returns the first job and starts nothing.
    """
    _require_mode(ctx.app, *modes)
    owner = JobOwner(
        tenant_id=ctx.app.tenant_id,
        app_id=ctx.app.id,
        caller_role=ctx.subject.caller_role,
        caller_id=ctx.caller.id,
    )
    key = body.idempotency_key
    run_jobs = application_services().run_jobs
    try:
        opened = run_jobs.open(JobOpening(owner=owner, mode=AppMode.value_of(ctx.app.mode), op=op, idempotency_key=key))
    except JobCapacityError as ex:
        raise JobCapacityReached() from ex
    if opened.created:
        _launch(ctx, body, run_jobs=run_jobs, opened=opened, key=key)
    end_read_transaction(ctx.session)
    try:
        view = run_jobs.wait(owner, opened.record.id, wait_seconds=body.wait_seconds)
    except JobNotFoundError as ex:
        raise JobNotFound() from ex
    return _job_state(view)


@openapi_ns.route("/apps/<string:app_id>/workflow:start")
class WorkflowStartApi(Resource):
    @endpoint(
        op=WORKFLOW_START_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        effect=Effect.WRITE,
        summary="Start a workflow app as a background job and wait for its result",
        requirements=_RUN_GUARDS,
        body=WorkflowStartPayload,
        examples=(Example(title="Start a workflow", input={"app_id": "<app_id>", "inputs": {"topic": "report"}}),),
        returns=_JOB_STATE,
    )
    def post(self, ctx: Context, app_id: str, *, body: WorkflowStartPayload):
        return start_job(ctx, body, op=WORKFLOW_START_OP, modes=(AppMode.WORKFLOW,))


@openapi_ns.route("/apps/<string:app_id>/advanced-chat:start")
class AdvancedChatStartApi(Resource):
    @endpoint(
        op=ADVANCED_CHAT_START_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        effect=Effect.WRITE,
        summary="Start an advanced-chat (chatflow) app as a background job and wait for its result",
        requirements=_RUN_GUARDS,
        body=AdvancedChatStartPayload,
        examples=(Example(title="Start a chatflow reply", input={"app_id": "<app_id>", "query": "Summarise it"}),),
        returns=_JOB_STATE,
    )
    def post(self, ctx: Context, app_id: str, *, body: AdvancedChatStartPayload):
        return start_job(ctx, body, op=ADVANCED_CHAT_START_OP, modes=(AppMode.ADVANCED_CHAT,))
