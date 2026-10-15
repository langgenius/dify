"""Typed fakes shared by the KnowledgeFS service tests that replace mock-based doubles."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import NamedTuple

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import KnowledgeFSUpgradeJob


def upgrade_job(*, job_id: str, old_dataset_id: str, tenant_id: str = "tenant-1") -> KnowledgeFSUpgradeJob:
    job = KnowledgeFSUpgradeJob(
        tenant_id=tenant_id,
        old_dataset_id=old_dataset_id,
        requested_by_account_id="account-1",
        owner_account_id="account-1",
        idempotency_key=f"upgrade-{job_id}",
        snapshot_at=naive_utc_now(),
        config_snapshot={},
        permission_snapshot={},
        app_binding_snapshot=[],
        tag_ids_snapshot=[],
    )
    job.id = job_id
    return job


class UnusedSession:
    """Session placeholder for code paths whose session use is patched out."""


class UnusedSessionFactory:
    def __init__(self) -> None:
        self.opened = 0

    @contextmanager
    def __call__(self) -> Iterator[UnusedSession]:
        self.opened += 1
        yield UnusedSession()


class RecordedCall(NamedTuple):
    args: tuple[object, ...]
    kwargs: dict[str, object]


@dataclass
class CallRecorder:
    """Callable stand-in that records every call and returns or raises a fixed outcome.

    Queued ``outcomes`` are consumed first, one per call; an exception outcome is raised.
    """

    result: object = None
    error: Exception | None = None
    outcomes: deque[object] = field(default_factory=deque)
    calls: list[RecordedCall] = field(default_factory=list)

    def __call__(self, *args: object, **kwargs: object) -> object:
        self.calls.append(RecordedCall(args, kwargs))
        if self.outcomes:
            outcome = self.outcomes.popleft()
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        if self.error is not None:
            raise self.error
        return self.result

    @property
    def last(self) -> RecordedCall:
        assert self.calls, "expected at least one call"
        return self.calls[-1]


def sent_payload[T](recorder: CallRecorder, payload_type: type[T]) -> T:
    """Return the ``payload`` keyword of the recorder's last call, checked against ``payload_type``."""
    payload = recorder.last.kwargs["payload"]
    assert isinstance(payload, payload_type)
    return payload
