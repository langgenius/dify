"""Redis store for app run jobs.

Each job is a hash: the record as created in one field written once, then one JSON-encoded field per later change
(run ids, the stop request, the ending). The alive key is refreshed while a reader runs.
"""

import json
from collections.abc import Mapping
from dataclasses import asdict
from dataclasses import fields as dataclass_fields
from typing import Any, Final, Protocol

from models.enums import CreatorUserRole
from models.model import AppMode
from services.run_job import (
    ALIVE_TTL_SECONDS,
    JobEnding,
    JobFailure,
    JobIds,
    JobOwner,
    JobRecord,
    JobStatus,
)

_JOB_KEY = "run_job:{job_id}"
_ALIVE_KEY = "run_job:{job_id}:alive"
_ALIVE_VALUE = "1"
_CREATED_FIELD: Final = "record"
_ENDING_FIELD: Final = "ending"
_RECORD_FIELDS = frozenset(field.name for field in dataclass_fields(JobRecord))


class RunJobRedis(Protocol):
    """The Redis calls the store makes; RedisClientWrapper satisfies it."""

    def set(self, name: str, value: Any, ex: int | None = None) -> Any: ...

    def hset(self, name: str, *, mapping: Mapping[str, str]) -> Any: ...

    def hsetnx(self, name: str, key: str, value: str) -> Any: ...

    def hgetall(self, name: str) -> Any: ...

    def expire(self, name: str, time: int) -> Any: ...

    def exists(self, *names: str) -> Any: ...

    def delete(self, *names: str) -> Any: ...


def _text(value: bytes | str) -> str:
    """Decode Redis output. Precondition: bytes or str. Postcondition: the str form."""
    return value.decode("utf-8") if isinstance(value, bytes) else value


def _decode_ending(raw: Mapping[str, Any] | None) -> JobEnding | None:
    """Rebuild an ending. Precondition: raw is a decoded ending field or None. Postcondition: the ending or None."""
    if raw is None:
        return None
    failure = raw["failure"]
    return JobEnding(
        status=JobStatus(raw["status"]),
        failure=None if failure is None else JobFailure(failure),
        error=raw["error"],
    )


def _decode_record(raw: Mapping[bytes | str, bytes | str]) -> JobRecord | None:
    """Rebuild a record from a hash. Postcondition: None without the created record; otherwise
    the created record with every later change applied. Fields a newer version added are ignored."""
    stored = {_text(name): json.loads(_text(value)) for name, value in raw.items()}
    created = stored.pop(_CREATED_FIELD, None)
    if created is None:
        return None
    fields = {name: value for name, value in {**created, **stored}.items() if name in _RECORD_FIELDS}
    owner = fields["owner"]
    fields["owner"] = JobOwner(**{**owner, "caller_role": CreatorUserRole(owner["caller_role"])})
    fields["mode"] = AppMode(fields["mode"])
    fields[_ENDING_FIELD] = _decode_ending(fields[_ENDING_FIELD])
    return JobRecord(**fields)


class RedisRunJobStore:
    def __init__(self, *, redis_client: RunJobRedis, job_ttl_seconds: int) -> None:
        """Bind the Redis client.

        Precondition: redis_client implements RunJobRedis; job_ttl_seconds is positive.
        Postcondition: the store reads and writes jobs through redis_client, and each write renews a job's key for
        job_ttl_seconds; nothing is written yet.
        """
        self._redis = redis_client
        self._job_ttl_seconds = job_ttl_seconds

    def create(self, record: JobRecord) -> bool:
        """Store a new job unless a job with its id exists.

        Precondition: record is a new job: no ids, no stop request, no ending.
        Postcondition: true when this call stored it (one HSETNX, so exactly one of several racing calls does):
        the job and its alive key exist with their TTLs. False with nothing written when the job already existed.
        """
        name = self._job_name(record.id)
        if not self._redis.hsetnx(name, _CREATED_FIELD, json.dumps(asdict(record))):
            return False
        self._redis.expire(name, self._job_ttl_seconds)
        self.touch(record.id)
        return True

    def get(self, job_id: str) -> JobRecord | None:
        """Load a job.

        Postcondition: returns the stored record, or None when it is absent, expired or incomplete.
        """
        return _decode_record(self._redis.hgetall(self._job_name(job_id)))

    def record_ids(self, job_id: str, ids: JobIds) -> None:
        """Store the run ids that are set.

        Postcondition: ids that are None are untouched; the job's TTL is renewed when anything was written; a job
        that no longer exists is not recreated.
        """
        fields = {name: json.dumps(value) for name, value in asdict(ids).items() if value is not None}
        self._write(job_id, fields)

    def settle(self, job_id: str, ending: JobEnding) -> bool:
        """Give the job its ending, unless it already has one.

        Postcondition: true when the job existed without an ending: the ending field now holds this one (HSETNX, so
        exactly one of several racing calls writes) and the TTL is renewed. False with nothing written otherwise.
        """
        name = self._job_name(job_id)
        if not self._redis.exists(name):
            return False
        written = bool(self._redis.hsetnx(name, _ENDING_FIELD, json.dumps(asdict(ending))))
        if written:
            self._redis.expire(name, self._job_ttl_seconds)
        return written

    def request_stop(self, job_id: str) -> None:
        """Record that the owner asked the job to stop.

        Postcondition: stop_requested is true and the TTL renewed; a job that no longer exists is not recreated.
        """
        self._write(job_id, {"stop_requested": json.dumps(True)})

    def _write(self, job_id: str, fields: Mapping[str, str]) -> None:
        """Set encoded fields of an existing job. Postcondition: nothing is written when fields
        is empty or the job is gone; otherwise the fields are set and the TTL renewed."""
        name = self._job_name(job_id)
        if not fields:
            return
        if not self._redis.exists(name):
            return
        self._redis.hset(name, mapping=fields)
        self._redis.expire(name, self._job_ttl_seconds)

    def discard(self, job_id: str) -> None:
        """Remove a job and its alive key. Postcondition: both keys are gone."""
        self._redis.delete(self._job_name(job_id), self._alive_name(job_id))

    def touch(self, job_id: str) -> None:
        """Refresh the alive key.

        Postcondition: the alive key exists and expires in ALIVE_TTL_SECONDS.
        """
        self._redis.set(self._alive_name(job_id), _ALIVE_VALUE, ex=ALIVE_TTL_SECONDS)

    def drop_alive(self, job_id: str) -> None:
        """Delete the alive key. Postcondition: is_alive is false until the next touch."""
        self._redis.delete(self._alive_name(job_id))

    def is_alive(self, job_id: str) -> bool:
        """Report whether the alive key is present.

        Postcondition: true only if touch or create ran within ALIVE_TTL_SECONDS.
        """
        return bool(self._redis.exists(self._alive_name(job_id)))

    @staticmethod
    def _job_name(job_id: str) -> str:
        """Job hash key. Postcondition: the key."""
        return _JOB_KEY.format(job_id=job_id)

    @staticmethod
    def _alive_name(job_id: str) -> str:
        """Alive key. Postcondition: the key."""
        return _ALIVE_KEY.format(job_id=job_id)
