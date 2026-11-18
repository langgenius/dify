"""Start routes on /openapi/v1: begin a run as a background job and answer with its state."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import MappingProxyType
from typing import Final

from flask_restx import Resource

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import openapi_ns
from controllers.openapi._audit import emit_app_run
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._errors import JobCapacityReached, JobNotFound
from controllers.openapi._files import end_read_transaction
from controllers.openapi._models import AdvancedChatStartPayload, JobState, WorkflowStartPayload
from controllers.openapi.app_run import RUN_GUARDS, generate_args, require_mode, run_stream
from controllers.openapi.auth.context import Context
from controllers.openapi.jobs import job_owner, job_state
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_application_services import application_services
from models.model import AppMode
from services.run_job_service import JobCapacityError, JobNotFoundError, JobOpening

START_OP_PREFIX: Final = "start.console_app."
WORKFLOW_START_OP: Final = f"{START_OP_PREFIX}workflow"
ADVANCED_CHAT_START_OP: Final = f"{START_OP_PREFIX}advanced_chat"
# The app modes each start op runs: every mode a job can run has exactly one.
START_MODES: Final[Mapping[str, tuple[AppMode, ...]]] = MappingProxyType(
    {
        WORKFLOW_START_OP: (AppMode.WORKFLOW,),
        ADVANCED_CHAT_START_OP: (AppMode.ADVANCED_CHAT,),
    }
)
_START_FIELDS: Final = frozenset({"wait_seconds", "idempotency_key"})
_JOB_STATE: Final = (200, JobState, "Job state")
APPS_SURFACE: Final = "apps"


type StartPayload = WorkflowStartPayload | AdvancedChatStartPayload


def _launch(ctx: Context, body: StartPayload) -> Iterable[str]:
    """Start the run and audit it, as the run route does.

    Precondition: the guards admitted the caller and the app's mode was checked.
    Postcondition: the run's SSE frames; errors of the run service propagate.
    """
    stream = run_stream(ctx, generate_args(ctx, body, exclude=_START_FIELDS), InvokeFrom.OPENAPI)
    emit_app_run(
        app_id=ctx.app.id,
        tenant_id=ctx.app.tenant_id,
        caller_kind=ctx.subject.caller_role,
        mode=str(ctx.app.mode),
        surface=APPS_SURFACE,
    )
    return stream


def start_job(ctx: Context, body: StartPayload, *, op: str) -> JobState:
    """Start a run as a background job and wait for its first result.

    Precondition: the guards admitted the caller, body is a start payload (wait_seconds, idempotency_key) and op is
    a key of START_MODES.
    Postcondition: a job exists and its run was accepted by the service, or the service's error was raised and no
    job remains. A repeated idempotency key returns the first job and starts nothing.
    """
    require_mode(ctx.app, *START_MODES[op])
    owner = job_owner(ctx)
    opening = JobOpening(owner=owner, mode=AppMode.value_of(ctx.app.mode), op=op, idempotency_key=body.idempotency_key)
    run_jobs = application_services().run_jobs
    try:
        job_id = run_jobs.start(opening, lambda: _launch(ctx, body))
    except JobCapacityError as ex:
        raise JobCapacityReached() from ex
    end_read_transaction(ctx.session)
    try:
        view = run_jobs.wait(owner, job_id, wait_seconds=body.wait_seconds)
    except JobNotFoundError as ex:
        raise JobNotFound() from ex
    return job_state(view, app_id=ctx.app.id)


@openapi_ns.route("/apps/<string:app_id>/workflow:start")
class WorkflowStartApi(Resource):
    @endpoint(
        op=WORKFLOW_START_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        effect=Effect.WRITE,
        summary="Start a workflow app as a background job and wait for its result",
        requirements=RUN_GUARDS,
        body=WorkflowStartPayload,
        examples=(Example(title="Start a workflow", input={"app_id": "<app_id>", "inputs": {"topic": "report"}}),),
        returns=_JOB_STATE,
    )
    def post(self, ctx: Context, app_id: str, *, body: WorkflowStartPayload):
        return start_job(ctx, body, op=WORKFLOW_START_OP)


@openapi_ns.route("/apps/<string:app_id>/advanced-chat:start")
class AdvancedChatStartApi(Resource):
    @endpoint(
        op=ADVANCED_CHAT_START_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        effect=Effect.WRITE,
        summary="Start an advanced-chat (chatflow) app as a background job and wait for its result",
        requirements=RUN_GUARDS,
        body=AdvancedChatStartPayload,
        examples=(Example(title="Start a chatflow reply", input={"app_id": "<app_id>", "query": "Summarise it"}),),
        returns=_JOB_STATE,
    )
    def post(self, ctx: Context, app_id: str, *, body: AdvancedChatStartPayload):
        return start_job(ctx, body, op=ADVANCED_CHAT_START_OP)
