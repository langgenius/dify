"""Redis store for app run jobs.

Each job is a hash with one JSON-encoded field per JobRecord attribute, plus an alive key
that the running side refreshes and an optional idempotency key that maps to the job id.
"""

import json
from collections.abc import Mapping
from dataclasses import asdict
from dataclasses import fields as dataclass_fields
from typing import Any, Final, Protocol

from models.enums import CreatorUserRole
from models.model import AppMode
from services.run_job_contracts import (
    ALIVE_TTL_SECONDS,
    JOB_TTL_SECONDS,
    JobEnding,
    JobFailure,
    JobIds,
    JobOwner,
    JobRecord,
    JobStatus,
    OpenedJob,
)

_JOB_KEY = "openapi:job:{job_id}"
_ALIVE_KEY = "openapi:job:{job_id}:alive"
_IDEMPOTENCY_KEY = "openapi:job:idem:{tenant_id}:{app_id}:{caller_role}:{caller_id}:{key}"
_ALIVE_VALUE = "1"
_RECORD_FIELDS = frozenset(field.name for field in dataclass_fields(JobRecord))
# Write the ending only while the job exists and its status is not final. ARGV: status, error, failure, TTL, then
# every final status; all values JSON-encoded as the record fields are. One key, so it also runs on Redis Cluster.
SETTLE_SCRIPT: Final = """
local current = redis.call('HGET', KEYS[1], 'status')
if not current then
    return 0
end
for index = 5, #ARGV do
    if current == ARGV[index] then
        return 0
    end
end
redis.call('HSET', KEYS[1], 'status', ARGV[1], 'error', ARGV[2], 'failure', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
"""
_FINAL_STATUSES: Final = tuple(json.dumps(status) for status in JobStatus if status.is_final)
_DELETE_IF_EQUAL = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


class RunJobRedis(Protocol):
    """The Redis calls the store makes; RedisClientWrapper satisfies it."""

    def set(self, name: str, value: Any, ex: int | None = None, *, nx: bool = False) -> Any: ...

    def get(self, name: str) -> Any: ...

    def hset(self, name: str, *, mapping: Mapping[str, str]) -> Any: ...

    def hgetall(self, name: str) -> Any: ...

    def expire(self, name: str, time: int) -> Any: ...

    def exists(self, *names: str) -> Any: ...

    def delete(self, *names: str) -> Any: ...

    def register_script(self, script: str) -> Any: ...


def _text(value: bytes | str) -> str:
    """Decode Redis output. Precondition: bytes or str. Postcondition: the str form."""
    return value.decode("utf-8") if isinstance(value, bytes) else value


def _encode_record(record: JobRecord) -> dict[str, str]:
    """Encode every record field. Precondition: JSON-serialisable fields. Postcondition: one JSON string per field."""
    fields = asdict(record)
    return {name: json.dumps(value) for name, value in fields.items()}


def _decode_record(raw: Mapping[bytes | str, bytes | str]) -> JobRecord | None:
    """Rebuild a record from a hash. Precondition: none. Postcondition: None unless every record field is present;
    fields that are not record fields (written by a newer version) are ignored."""
    if not _RECORD_FIELDS.issubset(_text(name) for name in raw):
        return None
    fields = {_text(name): json.loads(_text(value)) for name, value in raw.items() if _text(name) in _RECORD_FIELDS}
    fields["owner"] = JobOwner(
        tenant_id=fields["owner"]["tenant_id"],
        app_id=fields["owner"]["app_id"],
        caller_role=CreatorUserRole(fields["owner"]["caller_role"]),
        caller_id=fields["owner"]["caller_id"],
    )
    fields["mode"] = AppMode(fields["mode"])
    fields["status"] = JobStatus(fields["status"])
    if fields["failure"] is not None:
        fields["failure"] = JobFailure(fields["failure"])
    return JobRecord(**fields)


class RedisRunJobStore:
    def __init__(self, *, redis_client: RunJobRedis) -> None:
        """Bind the Redis client.

        Precondition: redis_client implements RunJobRedis.
        Postcondition: the store reads and writes jobs through redis_client; nothing is written yet.
        """
        self._redis = redis_client

    def open(self, record: JobRecord, *, idempotency_key: str | None) -> OpenedJob:
        """Store a new job, or return the job already bound to the idempotency key.

        Precondition: record.id is unused; idempotency_key is None or unique per caller and request.
        Postcondition: when created is True, the record, its alive key and (if given) the idempotency
        key exist with their TTLs; when False, no new job remains and record is the earlier job.
        """
        self._write_new(record)
        if idempotency_key is None:
            return OpenedJob(record=record, created=True)
        idem_name = self._idempotency_name(record.owner, idempotency_key)
        reserved, existing = self._bind(idem_name, record.id)
        if not reserved:
            if existing is None:
                self._release_stale(idem_name)
                reserved, existing = self._bind(idem_name, record.id)
        if reserved:
            return OpenedJob(record=record, created=True)
        self.discard(record.id, idempotency_key=None)
        if existing is None:
            raise RuntimeError("Idempotency key is contended; retry the request")
        return OpenedJob(record=existing, created=False)

    def get(self, job_id: str) -> JobRecord | None:
        """Load a job.

        Precondition: none.
        Postcondition: returns the stored record, or None when it is absent, expired or incomplete.
        """
        raw = self._redis.hgetall(self._job_name(job_id))
        if not raw:
            return None
        return _decode_record(raw)

    def record_ids(self, job_id: str, ids: JobIds) -> None:
        """Store the run ids that are set.

        Precondition: none.
        Postcondition: ids that are None are untouched; the job's TTL is renewed when anything was written; a job
        that no longer exists is not recreated.
        """
        fields = {name: json.dumps(value) for name, value in asdict(ids).items() if value is not None}
        self._write(job_id, fields)

    def settle(self, job_id: str, ending: JobEnding) -> bool:
        """Give the job its final status, unless it already has one.

        Precondition: none.
        Postcondition: true when the job existed and was not final: status, error and failure now hold ending and
        the TTL is renewed. False with nothing written otherwise. The check and the write are one script.
        """
        settle = self._redis.register_script(SETTLE_SCRIPT)
        args = [json.dumps(ending.status), json.dumps(ending.error), json.dumps(ending.failure), JOB_TTL_SECONDS]
        return bool(settle(keys=[self._job_name(job_id)], args=[*args, *_FINAL_STATUSES]))

    def request_stop(self, job_id: str) -> None:
        """Record that the owner asked the job to stop.

        Precondition: none.
        Postcondition: stop_requested is true and the TTL renewed; a job that no longer exists is not recreated.
        """
        self._write(job_id, {"stop_requested": json.dumps(True)})

    def _write(self, job_id: str, fields: Mapping[str, str]) -> None:
        """Set encoded fields of an existing job. Precondition: none. Postcondition: nothing is written when fields
        is empty or the job is gone; otherwise the fields are set and the TTL renewed."""
        name = self._job_name(job_id)
        if not fields:
            return
        if not self._redis.exists(name):
            return
        self._redis.hset(name, mapping=fields)
        self._redis.expire(name, JOB_TTL_SECONDS)

    def discard(self, job_id: str, *, idempotency_key: str | None) -> None:
        """Remove a job, its alive key and its idempotency key.

        Precondition: when idempotency_key is given, the job is still stored so the owner can be read.
        Postcondition: the job and alive keys are gone; the idempotency key is gone if it pointed here.
        """
        record = self.get(job_id)
        self._redis.delete(self._job_name(job_id), self._alive_name(job_id))
        if idempotency_key is None:
            return
        if record is None:
            return
        idem_name = self._idempotency_name(record.owner, idempotency_key)
        bound_id = self._redis.get(idem_name)
        if bound_id is None:
            return
        if _text(bound_id) != job_id:
            return
        self._redis.delete(idem_name)

    def touch(self, job_id: str) -> None:
        """Refresh the alive key.

        Precondition: none.
        Postcondition: the alive key exists and expires in ALIVE_TTL_SECONDS.
        """
        self._redis.set(self._alive_name(job_id), _ALIVE_VALUE, ex=ALIVE_TTL_SECONDS)

    def is_alive(self, job_id: str) -> bool:
        """Report whether the alive key is present.

        Precondition: none.
        Postcondition: true only if touch or open ran within ALIVE_TTL_SECONDS.
        """
        return bool(self._redis.exists(self._alive_name(job_id)))

    def _reserve(self, idem_name: str, job_id: str) -> bool:
        """Bind the idempotency key. Precondition: none. Postcondition: true only if this call bound it."""
        return bool(self._redis.set(idem_name, job_id, nx=True, ex=JOB_TTL_SECONDS))

    def _bind(self, idem_name: str, job_id: str) -> tuple[bool, JobRecord | None]:
        """Try to bind the key. Precondition: none. Postcondition: (True, None) when bound; else False and the job
        the key names, or None when that job vanished."""
        if self._reserve(idem_name, job_id):
            return True, None
        return False, self._bound_job(idem_name)

    def _bound_job(self, idem_name: str) -> JobRecord | None:
        """Load the job a key names. Precondition: none. Postcondition: None if unbound or the job vanished."""
        bound_id = self._redis.get(idem_name)
        return None if bound_id is None else self.get(_text(bound_id))

    def _release_stale(self, idem_name: str) -> None:
        """Free a key whose job vanished. Precondition: none.

        Postcondition: the key is deleted only if it still holds the id read now and that job is gone.
        """
        bound_id = self._redis.get(idem_name)
        if bound_id is None:
            return
        if self.get(_text(bound_id)) is not None:
            return
        delete_if_equal = self._redis.register_script(_DELETE_IF_EQUAL)
        delete_if_equal(keys=[idem_name], args=[_text(bound_id)])

    def _write_new(self, record: JobRecord) -> None:
        """Persist a record. Precondition: none. Postcondition: hash and alive key exist with their TTLs."""
        name = self._job_name(record.id)
        self._redis.hset(name, mapping=_encode_record(record))
        self._redis.expire(name, JOB_TTL_SECONDS)
        self.touch(record.id)

    @staticmethod
    def _job_name(job_id: str) -> str:
        """Job hash key. Precondition: none. Postcondition: the key."""
        return _JOB_KEY.format(job_id=job_id)

    @staticmethod
    def _alive_name(job_id: str) -> str:
        """Alive key. Precondition: none. Postcondition: the key."""
        return _ALIVE_KEY.format(job_id=job_id)

    @staticmethod
    def _idempotency_name(owner: JobOwner, key: str) -> str:
        """Idempotency key. Precondition: none. Postcondition: scoped to tenant, app, role and caller."""
        return _IDEMPOTENCY_KEY.format(
            tenant_id=owner.tenant_id,
            app_id=owner.app_id,
            caller_role=owner.caller_role.value,
            caller_id=owner.caller_id,
            key=key,
        )
