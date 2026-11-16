"""Job routes on /openapi/v1: wait for a background run's result, or stop it."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any, Final, Protocol

from flask_restx import Resource
from pydantic import ValidationError

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint, op_of
from controllers.openapi._errors import JobNotFound
from controllers.openapi._files import end_read_transaction
from controllers.openapi._models import Hint, JobState, JobWaitQuery
from controllers.openapi.app_run import _RUN_GUARDS
from controllers.openapi.auth.context import Context
from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormSubmitApi, form_hints
from core.app.entities.task_entities import HumanInputRequiredResponse
from extensions.ext_application_services import application_services
from services.run_job_contracts import JobOwner, JobStatus
from services.run_job_service import WAIT_DEFAULT_SECONDS, JobNotFoundError, JobView

logger = logging.getLogger(__name__)

WAIT_JOB_OP: Final = "wait.job"
STOP_JOB_OP: Final = "stop.job"
WAIT_HINT_SUMMARY: Final = "Wait for the result"
RESUMED_WAIT_HINT_SUMMARY: Final = "After submitting, wait for the resumed run"
_JOB_STATE: Final = (200, JobState, "Job state")


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


def _form_response(view: JobView) -> HumanInputRequiredResponse | None:
    """Rebuild the pause event of a paused job from its stored form and the ids on its record.

    Precondition: none.
    Postcondition: the event, or None when the job has no form, the record lacks the task or run id, or the stored
    form is not a human input form.
    """
    form: Mapping[str, Any] | None = view.form
    if form is None:
        return None
    record = view.record
    if record.task_id is None:
        return None
    if record.run_id is None:
        return None
    try:
        return HumanInputRequiredResponse.model_validate(
            {"task_id": record.task_id, "workflow_run_id": record.run_id, "data": form}
        )
    except ValidationError:
        logger.warning("Job %s holds a form that is not a human input form", record.id)
        return None


def _paused_hints(view: JobView, *, app_id: str) -> list[Hint]:
    """Offer the pending form's actions, then waiting.

    Precondition: the view's status is paused.
    Postcondition: one hint per form action followed by a wait hint that says it follows a submit; when no form
    hints can be built, only the plain wait hint.
    """
    response = _form_response(view)
    if response is None:
        return [_wait_hint(view, app_id=app_id, summary=WAIT_HINT_SUMMARY)]
    hints = form_hints(op=op_of(OpenApiWorkflowHumanInputFormSubmitApi.post), app_id=app_id, response=response)
    if not hints:
        return [_wait_hint(view, app_id=app_id, summary=WAIT_HINT_SUMMARY)]
    return [*hints, _wait_hint(view, app_id=app_id, summary=RESUMED_WAIT_HINT_SUMMARY)]


class _HintBuilder(Protocol):
    def __call__(self, view: JobView, *, app_id: str) -> list[Hint]: ...


HINTS_BY_STATUS: Final[Mapping[JobStatus, _HintBuilder]] = {
    JobStatus.RUNNING: _running_hints,
    JobStatus.PAUSED: _paused_hints,
    JobStatus.SUCCEEDED: _no_hints,
    JobStatus.FAILED: _no_hints,
    JobStatus.STOPPED: _no_hints,
}


def job_state(view: JobView, *, app_id: str) -> JobState:
    """Describe a job view with the next steps its status allows.

    Precondition: view belongs to the caller.
    Postcondition: the state carries the hints for its status.
    """
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
        hints=HINTS_BY_STATUS[view.status](view, app_id=app_id),
    )


@openapi_ns.route("/apps/<string:app_id>/jobs/<string:job_id>:wait")
class JobWaitApi(Resource):
    @endpoint(
        op=WAIT_JOB_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        summary="Wait for a background job to finish or pause, and read its state",
        requirements=_RUN_GUARDS,
        query=JobWaitQuery,
        examples=(Example(title="Wait for a job", input={"app_id": "<app_id>", "job_id": "<job_id>"}),),
        returns=_JOB_STATE,
    )
    def get(self, ctx: Context, app_id: str, job_id: str, *, query: JobWaitQuery):
        """Wait for a job of the caller.

        Precondition: the guards admitted the caller for the app.
        Postcondition: the job's state with hints after waiting up to query.wait_seconds; 404 job_not_found when the
        job is missing, expired or not the caller's for this app.
        """
        owner = job_owner(ctx)
        end_read_transaction(ctx.session)
        try:
            view = application_services().run_jobs.wait(owner, job_id, wait_seconds=query.wait_seconds)
        except JobNotFoundError as ex:
            raise JobNotFound() from ex
        return job_state(view, app_id=ctx.app.id)


@openapi_ns.route("/apps/<string:app_id>/jobs/<string:job_id>:stop")
class JobStopApi(Resource):
    @endpoint(
        op=STOP_JOB_OP,
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Ask a background job to stop, and read its state",
        requirements=_RUN_GUARDS,
        examples=(Example(title="Stop a job", input={"app_id": "<app_id>", "job_id": "<job_id>"}),),
        returns=_JOB_STATE,
    )
    def post(self, ctx: Context, app_id: str, job_id: str):
        """Stop a job of the caller.

        Precondition: the guards admitted the caller for the app.
        Postcondition: a job that is not final is asked to stop and its state is returned; 404 job_not_found when
        the job is missing, expired or not the caller's for this app.
        """
        owner = job_owner(ctx)
        end_read_transaction(ctx.session)
        try:
            view = application_services().run_jobs.stop(owner, job_id)
        except JobNotFoundError as ex:
            raise JobNotFound() from ex
        return job_state(view, app_id=ctx.app.id)
