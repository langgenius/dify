from __future__ import annotations

from types import SimpleNamespace

import pytest

MODULE = "schedule.trigger_provider_refresh_task"


class _SnapshotSession:
    """Returns an initial due-row snapshot when queried once.

    The legacy OFFSET publisher queries again after workers can update its first
    page. Its second query therefore observes the shifted due set and skips the
    middle rows. A snapshot publisher reads all due ids before it starts
    enqueueing work.
    """

    def __init__(self) -> None:
        self.execute_calls = 0
        self.rows = [
            ("tenant-1", "sub-1"),
            ("tenant-1", "sub-2"),
            ("tenant-1", "sub-3"),
            ("tenant-1", "sub-4"),
            ("tenant-1", "sub-5"),
        ]

    def __enter__(self) -> _SnapshotSession:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, _statement: object) -> SimpleNamespace:
        self.execute_calls += 1
        if self.execute_calls == 1:
            # This is the complete result a snapshot query must retain.
            return SimpleNamespace(all=lambda: self.rows)
        if self.execute_calls == 2:
            # After page one refreshes, rows 1 and 2 no longer satisfy the
            # due filter. OFFSET 2 now starts at sub-5, skipping sub-3/sub-4.
            return SimpleNamespace(all=lambda: [("tenant-1", "sub-5")])
        return SimpleNamespace(all=lambda: [])


@pytest.fixture
def publisher(monkeypatch: pytest.MonkeyPatch):
    import schedule.trigger_provider_refresh_task as task_module

    session = _SnapshotSession()
    dispatched: list[tuple[str, str]] = []

    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(task_module, "Session", lambda *_args, **_kwargs: session)
    monkeypatch.setattr(task_module, "current_timestamp", lambda: 1_000)
    monkeypatch.setattr(
        task_module,
        "dify_config",
        SimpleNamespace(
            TRIGGER_PROVIDER_REFRESH_BATCH_SIZE=2,
            TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS=60,
            TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS=60,
        ),
    )
    monkeypatch.setattr(task_module, "_acquire_locks", lambda **_kwargs: [True] * 2)
    monkeypatch.setattr(
        task_module,
        "trigger_subscription_refresh",
        SimpleNamespace(s=lambda *, tenant_id, subscription_id: (tenant_id, subscription_id)),
    )

    def record_group(jobs: list[tuple[str, str]]) -> SimpleNamespace:
        dispatched.extend(jobs)
        return SimpleNamespace(apply_async=lambda: "queued")

    monkeypatch.setattr(task_module, "group", record_group)
    return task_module, session, dispatched


def test_provider_refresh_enqueues_the_initial_due_snapshot_despite_updates(publisher) -> None:
    task_module, session, dispatched = publisher

    task_module.trigger_provider_refresh.run()

    assert dispatched == session.rows
