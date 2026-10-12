"""Tests for the interrupted-session reconciler beat sweeper (Task 5).

The reconciler is a backstop/notifier, not the mechanism that sets
``interrupted`` -- that is already derived on read (Task 3's
``get_session_view``: ``is_working(state) and not session_lock.exists(sid)``).
This task finds sessions stuck in a working state with no live advance lock
past ``DIFY_BUILDER_MAX_ADVANCE_SECONDS`` of staleness, publishes an
``interrupted`` signal to the progress bus for any live SSE to re-sync, and
logs. It must NOT mutate committed session state and must NOT re-enqueue.

Uses the same SQLite-backed ``SqlDifyBuilderRepository`` seed pattern as
``test_engine_on_sql_repo.py``/``test_advance_task.py``, with the task
module's outbound seams (``_session_factory``, ``naive_utc_now``,
``session_lock.exists``, ``progress_bus.publish``) monkeypatched.
"""

from collections.abc import Iterator
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

import schedule.dify_builder_reconcile_task as mod
from configs import dify_config
from core.dify_builder.models import ConversationItem, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from libs.datetime_utils import naive_utc_now
from models.base import Base
from services.dify_builder.repository import SqlDifyBuilderRepository
from tests.unit_tests.services.dify_builder.test_execution_policy_service import (
    owned as owned,  # noqa: PLC0414 - shared pytest fixture
)
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import (
    Owner,
)
from tests.unit_tests.services.dify_builder.test_real_call_consent_service import (
    consent_owner as consent_owner,  # noqa: PLC0414 - shared pytest fixture
)

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def factory(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def repo(factory: sessionmaker) -> SqlDifyBuilderRepository:
    return SqlDifyBuilderRepository(factory)


def _seed(repo: SqlDifyBuilderRepository, state: PcState) -> Session:
    s = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=state,
    )
    repo.create_session(s, DifyBuilderContext(), [ConversationItem(kind="run-context", seq=0)])
    return s


def test_reconcile_flags_stale_working_session_with_no_live_lock(
    monkeypatch, repo: SqlDifyBuilderRepository, factory: sessionmaker
) -> None:
    a = _seed(repo, PcState.FIX_VERIFY)  # working, no lock -> flagged
    b = _seed(repo, PcState.FIX_VERIFY)  # working, live lock -> skipped
    c = _seed(repo, PcState.FIX_AWAIT_VERIFY)  # waiting -> never considered

    real_now = naive_utc_now()
    monkeypatch.setattr(mod, "_session_factory", lambda: factory)
    monkeypatch.setattr(
        mod,
        "naive_utc_now",
        lambda: real_now + timedelta(seconds=2 * dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS),
    )
    monkeypatch.setattr(mod.session_lock, "exists", lambda sid: sid == b.id)

    published: list[tuple[str, dict]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: published.append((sid, ev)))

    count = mod.reconcile_interrupted_sessions()

    assert count == 1
    assert published == [(a.id, {"kind": "error", "error": "interrupted"})]
    assert c.id  # sanity: C was seeded (and never touched)


def test_reconcile_empty_sweep_when_nothing_stale(
    monkeypatch, repo: SqlDifyBuilderRepository, factory: sessionmaker
) -> None:
    _seed(repo, PcState.FIX_VERIFY)  # working, freshly seeded -> not stale

    monkeypatch.setattr(mod, "_session_factory", lambda: factory)
    monkeypatch.setattr(mod.session_lock, "exists", lambda _sid: False)

    published: list[tuple[str, dict]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: published.append((sid, ev)))

    count = mod.reconcile_interrupted_sessions()

    assert count == 0
    assert published == []


def test_reconcile_settles_stranded_confirmed_launch_without_redispatch(
    monkeypatch: pytest.MonkeyPatch, consent_owner: "Owner"
) -> None:
    """A reserved confirmed command whose worker never ran is failed before any claim.

    The sweeper never re-enqueues, never rewrites the session head and never
    touches spent counters; settlement is owned by the consent service.
    """
    from models.dify_builder import DifyBuilderSession
    from tests.unit_tests.services.dify_builder.test_confirmed_tool_launch import reserve_directly

    owner = consent_owner
    reserved, _action, _token = reserve_directly(owner)
    with owner.factory() as db:
        head = db.get(DifyBuilderSession, owner.session_id)
        assert head is not None
        before = (head.version, head.current_state)
    real_now = naive_utc_now()
    monkeypatch.setattr(mod, "_session_factory", lambda: owner.factory)
    monkeypatch.setattr(
        mod, "naive_utc_now", lambda: real_now + timedelta(seconds=2 * dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS)
    )
    monkeypatch.setattr(mod.session_lock, "exists", lambda _sid: False)
    published: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(mod.progress_bus, "publish", lambda sid, ev: published.append((sid, ev)))

    assert mod.reconcile_interrupted_sessions() == 1

    row = owner.consent_row(reserved.consent_id)
    assert (row.state, row.reason_code, row.claimed_at, row.refresh_count, row.business_count) == (
        "failed",
        "launch_stranded",
        None,
        0,
        0,
    )
    with owner.factory() as db:
        head = db.get(DifyBuilderSession, owner.session_id)
        assert head is not None
        assert (head.version, head.current_state) == before
    assert published == [(owner.session_id, {"kind": "error", "error": "interrupted"})]


def test_reconcile_skips_confirmed_launch_while_its_lease_is_live(
    monkeypatch: pytest.MonkeyPatch, consent_owner: "Owner"
) -> None:
    from tests.unit_tests.services.dify_builder.test_confirmed_tool_launch import reserve_directly

    owner = consent_owner
    reserved, _action, _token = reserve_directly(owner)
    real_now = naive_utc_now()
    monkeypatch.setattr(mod, "_session_factory", lambda: owner.factory)
    monkeypatch.setattr(
        mod, "naive_utc_now", lambda: real_now + timedelta(seconds=2 * dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS)
    )
    monkeypatch.setattr(mod.session_lock, "exists", lambda _sid: True)
    monkeypatch.setattr(mod.progress_bus, "publish", lambda *_args: None)

    assert mod.reconcile_interrupted_sessions() == 0
    assert owner.consent_row(reserved.consent_id).state == "confirmed"


def test_stranded_observation_and_settlement_close_sql_before_redis(
    monkeypatch: pytest.MonkeyPatch, consent_owner: "Owner"
) -> None:
    """The snapshot read and each settlement transaction end before lease/bus I/O."""
    from sqlalchemy.engine import Connection

    from tests.unit_tests.services.dify_builder.test_confirmed_tool_launch import reserve_directly

    owner = consent_owner
    reserved, _action, _token = reserve_directly(owner)
    engine = owner.factory.kw["bind"]
    active: set[Connection] = set()
    boundaries: list[str] = []

    def begin(connection: Connection) -> None:
        active.add(connection)

    def end(connection: Connection) -> None:
        active.discard(connection)

    def lease_held(_session_id: str) -> bool:
        assert not active, "a lease read happened while the sweeper still held SQL"
        boundaries.append("lease")
        return False

    def publish(_session_id: str, _event: dict[str, object]) -> None:
        assert not active, "the progress bus ran while settlement still held SQL"
        boundaries.append("publish")

    event.listen(engine, "begin", begin)
    event.listen(engine, "commit", end)
    event.listen(engine, "rollback", end)
    try:
        stale_now = naive_utc_now() + timedelta(days=1)
        monkeypatch.setattr(mod, "_session_factory", lambda: owner.factory)
        monkeypatch.setattr(mod, "naive_utc_now", lambda: stale_now)
        monkeypatch.setattr(mod.session_lock, "exists", lease_held)
        monkeypatch.setattr(mod.progress_bus, "publish", publish)

        assert mod.reconcile_interrupted_sessions() == 1
        assert boundaries[:2] == ["lease", "publish"]
        assert not active
        assert owner.consent_row(reserved.consent_id).state == "failed"
    finally:
        event.remove(engine, "begin", begin)
        event.remove(engine, "commit", end)
        event.remove(engine, "rollback", end)
