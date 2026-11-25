"""Run jobs: an app run started in the background, whose result its owner reads later.

``RunJobService.start`` launches a run and a reader thread that reads its stream to the end; ``view``, ``wait`` and
``stop`` serve the job's owner. A job's state lives in a ``RunJobStore``; the run's result is read through a
``RunResultReader`` and its stop goes through ``RunTaskControl``. The host passes the store, the reader, the task
control and the caps; the package reads no configuration and knows no route or login.
"""

from services.run_job.contracts import (
    ALIVE_TTL_SECONDS,
    JobEnding,
    JobFailure,
    JobIds,
    JobOwner,
    JobRecord,
    JobStatus,
    RunJobStore,
)
from services.run_job.frames import pending_form
from services.run_job.reader import RUN_STATUS_TO_JOB_STATUS
from services.run_job.schemas import IDEMPOTENCY_KEY_MAX_LENGTH, JobResult, JobStartFields, JobWaitQuery
from services.run_job.service import (
    READER_THREAD_NAME,
    WAIT_DEFAULT_SECONDS,
    WAIT_MAX_SECONDS,
    JobCapacityError,
    JobNotFoundError,
    JobOpening,
    JobView,
    MessageResult,
    RunJobService,
    RunResult,
    RunResultReader,
    RunTaskControl,
)

__all__ = [
    "ALIVE_TTL_SECONDS",
    "IDEMPOTENCY_KEY_MAX_LENGTH",
    "READER_THREAD_NAME",
    "RUN_STATUS_TO_JOB_STATUS",
    "WAIT_DEFAULT_SECONDS",
    "WAIT_MAX_SECONDS",
    "JobCapacityError",
    "JobEnding",
    "JobFailure",
    "JobIds",
    "JobNotFoundError",
    "JobOpening",
    "JobOwner",
    "JobRecord",
    "JobResult",
    "JobStartFields",
    "JobStatus",
    "JobView",
    "JobWaitQuery",
    "MessageResult",
    "RunJobService",
    "RunJobStore",
    "RunResult",
    "RunResultReader",
    "RunTaskControl",
    "pending_form",
]
