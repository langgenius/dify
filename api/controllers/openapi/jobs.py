"""Job routes on /openapi/v1: wait for a background run's result, or stop it.

A stream operation started as a job (``_stream_result.py``) is served here. The guards are the run guards without
the web-access check: a draft test needs no web access, and the job service finds a job only for its owner.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Final, Protocol

from flask_restx import Resource

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint, op_of
from controllers.openapi._errors import JobCapacityReached, JobNotFound, require_uuid
from controllers.openapi._files import end_read_transaction
from controllers.openapi._models import Hint, JobState
from controllers.openapi.app_run import JOB_GUARDS, reply_hint, takes_reply
from controllers.openapi.auth.context import Context
from controllers.openapi.human_input_form import (
    OpenApiWorkflowHumanInputFormSubmitApi,
    form_hints,
    is_answerable_over_openapi,
)
from extensions.ext_application_services import application_services
from models.model import AppMode
from services.run_job import (
    WAIT_DEFAULT_SECONDS,
    JobCapacityError,
    JobNotFoundError,
    JobOpening,
    JobOwner,
    JobStartFields,
    JobStatus,
    JobView,
    JobWaitQuery,
)

WAIT_JOB_OP: Final = "wait.job"
STOP_JOB_OP: Final = "stop.job"
WAIT_HINT_SUMMARY: Final = "Wait for the result"
RESUMED_WAIT_HINT_SUMMARY: Final = "After submitting, wait for the resumed run"
CONSOLE_FORM_WAIT_SUMMARY: Final = "After a human answers the form in the console, wait for the resumed run"
CONSOLE_FORM_NOTE: Final = (
    "The run waits for a form that this login cannot answer. A human must answer it in the Dify console."
)
JOB_STATE_RESPONSE: Final = (200, JobState, "Job state")


def job_owner(ctx: Context) -> JobOwner:
    """Name the caller that owns the jobs of this request.

    Precondition: the guards admitted the caller for ctx.app.
    Postcondition: an owner of ctx.app that matches only this caller.
    """
    return JobOwner(
        tenant_id=ctx.app.tenant_id,
        app_id=ctx.app.id,
        caller_role=ctx.subject.caller_role,
        caller_id=ctx.caller.id,
    )


def _wait_hint(view: JobView, *, app_id: str, summary: str) -> Hint:
    """Point at wait.job for the view's job.

    Precondition: view belongs to the caller.
    Postcondition: a hint whose input names the app and job and the default wait.
    """
    return Hint(
        summary=summary,
        op=WAIT_JOB_OP,
        input={"app_id": app_id, "job_id": view.record.id, "wait_seconds": WAIT_DEFAULT_SECONDS},
    )


def _no_hints(view: JobView, *, app_id: str) -> list[Hint]:
    """Offer no next step.

    Precondition: the view's status is final.
    Postcondition: an empty list.
    """
    return []


def _running_hints(view: JobView, *, app_id: str) -> list[Hint]:
    """Offer waiting for the result.

    Precondition: the view's status is running.
    Postcondition: one wait hint.
    """
    return [_wait_hint(view, app_id=app_id, summary=WAIT_HINT_SUMMARY)]


def _paused_hints(view: JobView, *, app_id: str) -> list[Hint]:
    """Offer the pending form's actions, then waiting.

    Precondition: the view's status is paused.
    Postcondition: one hint per form action followed by a wait hint that says it follows a submit. A form this
    login cannot answer (see ``is_answerable_over_openapi``) gets only a wait hint for after a human answered it in
    the console; when no form is known, or it has no action, only the plain wait hint.
    """
    if view.form is None:
        return [_wait_hint(view, app_id=app_id, summary=WAIT_HINT_SUMMARY)]
    if not is_answerable_over_openapi(view.form):
        return [_wait_hint(view, app_id=app_id, summary=CONSOLE_FORM_WAIT_SUMMARY)]
    hints = form_hints(op=op_of(OpenApiWorkflowHumanInputFormSubmitApi.post), app_id=app_id, response=view.form)
    if not hints:
        return [_wait_hint(view, app_id=app_id, summary=WAIT_HINT_SUMMARY)]
    return [*hints, _wait_hint(view, app_id=app_id, summary=RESUMED_WAIT_HINT_SUMMARY)]


def _succeeded_hints(view: JobView, *, app_id: str) -> list[Hint]:
    """Offer a reply in the job's conversation, as the job's stream would.

    Precondition: the view's status is succeeded.
    Postcondition: one hint that runs the job's own op in its conversation; empty when the job has no conversation
    or its op takes no conversation (``takes_reply``), as an op that follows a run's events does not.
    """
    record = view.record
    if record.conversation_id is None:
        return []
    if not takes_reply(record.op):
        return []
    return [reply_hint(op=record.op, app_id=app_id, conversation_id=record.conversation_id)]


class _HintBuilder(Protocol):
    def __call__(self, view: JobView, *, app_id: str) -> list[Hint]: ...


HINTS_BY_STATUS: Final[Mapping[JobStatus, _HintBuilder]] = {
    JobStatus.RUNNING: _running_hints,
    JobStatus.PAUSED: _paused_hints,
    JobStatus.SUCCEEDED: _succeeded_hints,
    JobStatus.FAILED: _no_hints,
    JobStatus.STOPPED: _no_hints,
}


def _note(view: JobView) -> str | None:
    """Postcondition: ``CONSOLE_FORM_NOTE`` for a paused job whose form this login cannot answer; None otherwise."""
    if view.status is not JobStatus.PAUSED:
        return None
    if view.form is None:
        return None
    if is_answerable_over_openapi(view.form):
        return None
    return CONSOLE_FORM_NOTE


def job_state(view: JobView, *, app_id: str) -> JobState:
    """Describe a job view with the next steps its status allows.

    Precondition: view belongs to the caller.
    Postcondition: the state carries the hints for its status, and the note ``_note`` gives.
    """
    state = JobState.of(view)
    state.hints = HINTS_BY_STATUS[view.status](view, app_id=app_id)
    state.note = _note(view)
    return state


def job_state_from(call: Callable[[], JobView], *, app_id: str) -> JobState:
    """Postcondition: the state of the job call() returns; JobNotFound when the service finds no such job."""
    try:
        view = call()
    except JobNotFoundError as ex:
        raise JobNotFound() from ex
    return job_state(view, app_id=app_id)


def start_job(ctx: Context, *, op: str, fields: JobStartFields, launch: Callable[[], Iterable[str]]) -> JobState:
    """Start a stream operation's run as a background job and wait for its first result.

    Precondition: the operation's guards admitted the caller for ctx.app; launch is the operation's handler, which
    checks the app's mode, starts and audits the run and returns its SSE frames.
    Postcondition: a job of op exists and launch ran once, or the handler's error was raised and no job remains. A
    repeated idempotency key returns the first job and launch does not run. At the background cap, 429
    JobCapacityReached and launch does not run. The read transaction is ended before waiting up to
    fields.wait_seconds.
    """
    owner = job_owner(ctx)
    opening = JobOpening(
        owner=owner, mode=AppMode.value_of(ctx.app.mode), op=op, idempotency_key=fields.idempotency_key
    )
    run_jobs = application_services().run_jobs
    try:
        job_id = run_jobs.start(opening, launch)
    except JobCapacityError as ex:
        raise JobCapacityReached() from ex
    end_read_transaction(ctx.session)
    return job_state_from(lambda: run_jobs.wait(owner, job_id, wait_seconds=fields.wait_seconds), app_id=ctx.app.id)


@openapi_ns.route("/apps/<string:app_id>/jobs/<string:job_id>:wait")
class JobWaitApi(Resource):
    @endpoint(
        op=WAIT_JOB_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        summary="Wait for a background job to finish or pause, and read its state",
        requirements=JOB_GUARDS,
        query=JobWaitQuery,
        examples=(Example(title="Wait for a job", input={"app_id": "<app_id>", "job_id": "<job_id>"}),),
        returns=JOB_STATE_RESPONSE,
    )
    def get(self, ctx: Context, app_id: str, job_id: str, *, query: JobWaitQuery):
        """Wait for a job of the caller.

        Precondition: the guards admitted the caller for the app.
        Postcondition: the job's state with hints after waiting up to query.wait_seconds; 404 job_not_found when the
        job is missing, expired or not the caller's for this app.
        """
        valid_id = require_uuid(job_id, not_found=JobNotFound)
        owner = job_owner(ctx)
        end_read_transaction(ctx.session)
        run_jobs = application_services().run_jobs
        return job_state_from(
            lambda: run_jobs.wait(owner, valid_id, wait_seconds=query.wait_seconds), app_id=ctx.app.id
        )


@openapi_ns.route("/apps/<string:app_id>/jobs/<string:job_id>:stop")
class JobStopApi(Resource):
    @endpoint(
        op=STOP_JOB_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Ask a background job to stop, and read its state",
        requirements=JOB_GUARDS,
        examples=(Example(title="Stop a job", input={"app_id": "<app_id>", "job_id": "<job_id>"}),),
        returns=JOB_STATE_RESPONSE,
    )
    def post(self, ctx: Context, app_id: str, job_id: str):
        """Stop a job of the caller.

        Precondition: the guards admitted the caller for the app.
        Postcondition: a job that is not final is asked to stop and its state is returned; 404 job_not_found when
        the job is missing, expired or not the caller's for this app.
        """
        valid_id = require_uuid(job_id, not_found=JobNotFound)
        owner = job_owner(ctx)
        end_read_transaction(ctx.session)
        return job_state_from(lambda: application_services().run_jobs.stop(owner, valid_id), app_id=ctx.app.id)
