"""Parse bounded CSV imports and publish owned jobs after database admission."""

import logging
import time
from csv import Error as CSVError
from dataclasses import dataclass
from typing import IO, Literal, Protocol, TypedDict
from uuid import uuid4

import pandas as pd

from services.annotation_query import AnnotationAppQuery

logger = logging.getLogger(__name__)


class AnnotationImportValidationError(Exception):
    """The CSV or its record count cannot be accepted for import."""


class AnnotationImportLimitError(Exception):
    """The workspace's request or concurrent-import limit was reached."""


class AnnotationImportJobNotFoundError(Exception):
    """The job is absent or cannot be verified as belonging to this workspace and app."""


class AnnotationImportRecord(TypedDict):
    question: str
    answer: str


@dataclass(frozen=True, slots=True)
class AnnotationImportJob:
    job_id: str
    job_status: str
    error_msg: str = ""


@dataclass(frozen=True, slots=True)
class AnnotationImportResult:
    job_id: str
    job_status: str
    record_count: int


@dataclass(frozen=True, slots=True)
class AnnotationImportLimits:
    min_records: int
    max_records: int
    requests_per_minute: int
    requests_per_hour: int
    max_concurrent: int


@dataclass(frozen=True, slots=True)
class AnnotationImportQuota:
    """A positive limit caps total records; nonpositive limits retain unlimited semantics."""

    limit: int
    size: int

    def validate(self, *, record_count: int) -> None:
        if 0 < self.limit < self.size + record_count:
            raise AnnotationImportValidationError("The number of annotations exceeds the limit of your subscription.")


class AnnotationImportQuotaQuery(Protocol):
    def __call__(self, *, tenant_id: str) -> AnnotationImportQuota | None:
        """Return workspace quota, or None when subscription limits do not apply."""
        ...


class AnnotationImportJobStore(Protocol):
    def record_request(self, *, tenant_id: str, window_seconds: Literal[60, 3600], now_ms: int) -> int: ...

    def count_active(self, *, tenant_id: str, now_ms: int) -> int: ...

    def create(self, *, tenant_id: str, app_id: str, job_id: str, now_ms: int) -> None: ...

    def release(self, *, tenant_id: str, job_id: str) -> None: ...

    def get(self, *, tenant_id: str, app_id: str, job_id: str) -> AnnotationImportJob | None:
        """Return an owned job's state; absent or unverifiable jobs return None."""
        ...


class PublishAnnotationImport(Protocol):
    def __call__(
        self,
        *,
        job_id: str,
        content_list: list[AnnotationImportRecord],
        app_id: str,
        tenant_id: str,
        user_id: str,
    ) -> object: ...


def parse_annotation_csv(stream: IO[bytes], *, min_records: int, max_records: int) -> list[AnnotationImportRecord]:
    """Keep the existing bounded parser, literal NA handling and positional column contract."""
    stream.seek(0)
    first_chunk = stream.read(8192)
    stream.seek(0)
    if first_chunk.count(b"\n") == 0:
        raise AnnotationImportValidationError("The CSV file appears to be empty or invalid.")
    try:
        dataframe = pd.read_csv(
            stream, dtype=str, keep_default_na=False, nrows=max_records + 1, engine="python", on_bad_lines="skip"
        )
    except (ValueError, CSVError) as exc:
        raise AnnotationImportValidationError(str(exc)) from exc
    if len(dataframe.columns) < 2:
        raise AnnotationImportValidationError(
            "Invalid CSV format. The file must contain at least 2 columns (question and answer)."
        )
    records: list[AnnotationImportRecord] = []
    for index, row in dataframe.iterrows():
        if len(records) >= max_records:
            raise AnnotationImportValidationError(
                f"The CSV file contains too many records. Maximum {max_records} records allowed per import. "
                "Please split your file into smaller batches."
            )
        try:
            question_raw, answer_raw = row.iloc[0], row.iloc[1]
        except (IndexError, KeyError):
            continue
        question = str(question_raw).strip() if question_raw is not None else ""
        answer = str(answer_raw).strip() if answer_raw is not None else ""
        if not question or not answer or question.lower() == "nan" or answer.lower() == "nan":
            continue
        row_number = int(index) + 2 if isinstance(index, (int, float)) else len(records) + 2
        if len(question) > 2000:
            raise AnnotationImportValidationError(
                f"Question at row {row_number} is too long. Maximum 2000 characters allowed."
            )
        if len(answer) > 10000:
            raise AnnotationImportValidationError(
                f"Answer at row {row_number} is too long. Maximum 10000 characters allowed."
            )
        records.append({"question": question, "answer": answer})
    if len(records) < min_records:
        raise AnnotationImportValidationError(
            f"The CSV file must contain at least {min_records} valid annotation record(s). "
            f"Found {len(records)} valid record(s)."
        )
    return records


class AnnotationImportService:
    def __init__(
        self,
        *,
        apps: AnnotationAppQuery,
        jobs: AnnotationImportJobStore,
        publish: PublishAnnotationImport,
        quota: AnnotationImportQuotaQuery,
        limits: AnnotationImportLimits,
    ) -> None:
        self._apps = apps
        self._jobs = jobs
        self._publish = publish
        self._quota = quota
        self._limits = limits

    def import_csv(self, *, tenant_id: str, app_id: str, account_id: str, stream: IO[bytes]) -> AnnotationImportResult:
        self._apps.require_app(tenant_id=tenant_id, app_id=app_id)
        self._check_limits(tenant_id=tenant_id)
        records = parse_annotation_csv(
            stream, min_records=self._limits.min_records, max_records=self._limits.max_records
        )
        quota = self._quota(tenant_id=tenant_id)
        if quota is not None:
            quota.validate(record_count=len(records))
        job_id = str(uuid4())
        try:
            self._jobs.create(tenant_id=tenant_id, app_id=app_id, job_id=job_id, now_ms=int(time.time() * 1000))
            self._publish(job_id=job_id, content_list=records, app_id=app_id, tenant_id=tenant_id, user_id=account_id)
        except Exception:
            # Preserve the publishing error even when Redis cleanup also fails.
            try:
                self._jobs.release(tenant_id=tenant_id, job_id=job_id)
            except Exception:
                logger.exception("Failed to release annotation import job %s in workspace %s", job_id, tenant_id)
            raise
        return AnnotationImportResult(job_id=job_id, job_status="waiting", record_count=len(records))

    def get_status(self, *, tenant_id: str, app_id: str, job_id: str) -> AnnotationImportJob:
        self._apps.require_app(tenant_id=tenant_id, app_id=app_id)
        job = self._jobs.get(tenant_id=tenant_id, app_id=app_id, job_id=job_id)
        if job is None:
            raise AnnotationImportJobNotFoundError(f"Annotation import job {job_id} is unavailable for app {app_id}")
        return job

    def _check_limits(self, *, tenant_id: str) -> None:
        now_ms = int(time.time() * 1000)
        if (
            self._jobs.record_request(tenant_id=tenant_id, window_seconds=60, now_ms=now_ms)
            > self._limits.requests_per_minute
        ):
            raise AnnotationImportLimitError(
                f"Too many annotation import requests. Maximum {self._limits.requests_per_minute} "
                "requests per minute allowed. Please try again later."
            )
        if (
            self._jobs.record_request(tenant_id=tenant_id, window_seconds=3600, now_ms=now_ms)
            > self._limits.requests_per_hour
        ):
            raise AnnotationImportLimitError(
                f"Too many annotation import requests. Maximum {self._limits.requests_per_hour} "
                "requests per hour allowed. Please try again later."
            )
        # Keep the existing separate admission/registration steps; atomic reservations need a worker lifecycle change.
        if self._jobs.count_active(tenant_id=tenant_id, now_ms=now_ms) >= self._limits.max_concurrent:
            raise AnnotationImportLimitError(
                f"Too many concurrent import tasks. Maximum {self._limits.max_concurrent} "
                "concurrent imports allowed per workspace. Please wait for existing imports to complete."
            )
