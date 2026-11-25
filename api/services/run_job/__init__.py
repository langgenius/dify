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

__all__ = [
    "ALIVE_TTL_SECONDS",
    "JobEnding",
    "JobFailure",
    "JobIds",
    "JobOwner",
    "JobRecord",
    "JobStatus",
    "RunJobStore",
]
