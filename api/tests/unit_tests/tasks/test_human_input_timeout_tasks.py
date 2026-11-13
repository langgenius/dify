from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.db.session_factory as session_factory_module
from core.repositories.human_input_repository import HumanInputFormRecord, HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.entities import FormDefinition
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from models.human_input import HumanInputForm
from models.workflow import WorkflowPause
from tasks import human_input_timeout_tasks as task_module
from tests.helpers.unit.config_override import apply_config_overrides


def _build_form(
    *,
    form_id: str,
    form_kind: HumanInputFormKind,
    created_at: datetime,
    expiration_time: datetime,
    workflow_run_id: str | None,
    node_id: str,
    conversation_id: str | None = None,
) -> HumanInputForm:
    form_definition = FormDefinition(
        form_content="",
        rendered_content="",
        expiration_time=expiration_time,
    )
    return HumanInputForm(
        id=form_id,
        tenant_id="tenant-1",
        app_id="app-1",
        form_kind=form_kind,
        created_at=created_at,
        expiration_time=expiration_time,
        workflow_run_id=workflow_run_id,
        conversation_id=conversation_id,
        node_id=node_id,
        form_definition=form_definition.model_dump_json(),
        rendered_content="",
        status=HumanInputFormStatus.WAITING,
    )


def _require_form(session: Session, form_id: str) -> HumanInputForm:
    form = session.get(HumanInputForm, form_id)
    assert form is not None
    return form


@pytest.fixture
def sqlite_task_database(
    sqlite_engine: Engine,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(session_factory_module, "_session_maker", repository_session_maker)
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=sqlite_engine))


def test_is_global_timeout_uses_created_at() -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    form = _build_form(
        form_id="form-1",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now - timedelta(seconds=61),
        expiration_time=now + timedelta(hours=1),
        workflow_run_id="run-1",
        node_id="node-1",
    )

    assert task_module._is_global_timeout(form, 60, now=now) is True

    form.workflow_run_id = None
    assert task_module._is_global_timeout(form, 60, now=now) is False

    form.workflow_run_id = "run-1"
    form.created_at = now - timedelta(seconds=59)
    assert task_module._is_global_timeout(form, 60, now=now) is False

    assert task_module._is_global_timeout(form, 0, now=now) is False


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm, WorkflowPause)], indirect=True)
def test_check_and_handle_human_input_timeouts_marks_and_routes(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=3600)

    forms = [
        _build_form(
            form_id="form-global",
            form_kind=HumanInputFormKind.RUNTIME,
            created_at=now - timedelta(hours=2),
            expiration_time=now + timedelta(hours=1),
            workflow_run_id="run-global",
            node_id="node-global",
        ),
        _build_form(
            form_id="form-node",
            form_kind=HumanInputFormKind.RUNTIME,
            created_at=now - timedelta(minutes=5),
            expiration_time=now - timedelta(seconds=1),
            workflow_run_id="run-node",
            node_id="node-node",
        ),
        _build_form(
            form_id="form-delivery",
            form_kind=HumanInputFormKind.DELIVERY_TEST,
            created_at=now - timedelta(minutes=1),
            expiration_time=now - timedelta(seconds=1),
            workflow_run_id=None,
            node_id="node-delivery",
        ),
    ]
    sqlite_session.add_all(forms)
    pause = WorkflowPause(workflow_id="workflow-1", workflow_run_id="run-node", state_object_key="pause-state")
    sqlite_session.add(pause)
    sqlite_session.commit()

    repo = HumanInputFormSubmissionRepository()
    mark_timeout_calls: list[tuple[str, HumanInputFormStatus, str | None, bool]] = []
    mark_timeout = repo.mark_timeout

    def record_mark_timeout(
        *,
        form_id: str,
        timeout_status: HumanInputFormStatus,
        reason: str | None = None,
        request_resume: bool = False,
    ) -> HumanInputFormRecord:
        mark_timeout_calls.append((form_id, timeout_status, reason, request_resume))
        return mark_timeout(
            form_id=form_id,
            timeout_status=timeout_status,
            reason=reason,
            request_resume=request_resume,
        )

    global_timeout_calls: list[tuple[str, str, str, sessionmaker[Session]]] = []

    def record_global_timeout(
        *, form_id: str, workflow_run_id: str, node_id: str, session_factory: sessionmaker[Session]
    ) -> None:
        global_timeout_calls.append((form_id, workflow_run_id, node_id, session_factory))

    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", lambda: repo)
    monkeypatch.setattr(repo, "mark_timeout", record_mark_timeout)
    monkeypatch.setattr(task_module, "_handle_global_timeout", record_global_timeout)
    dispatched_limits: list[int] = []
    monkeypatch.setattr(
        task_module,
        "_dispatch_pending_human_input_resumes",
        lambda limit, workflow_run_id=None: dispatched_limits.append(limit),
    )
    monkeypatch.setattr(task_module, "_enqueue_human_input_v2_timeouts", lambda limit: None)

    task_module.check_and_handle_human_input_timeouts(limit=100)

    assert {(call[0], call[1], call[2]) for call in mark_timeout_calls} == {
        ("form-global", HumanInputFormStatus.EXPIRED, "global_timeout"),
        ("form-node", HumanInputFormStatus.TIMEOUT, "node_timeout"),
        ("form-delivery", HumanInputFormStatus.TIMEOUT, "delivery_test_timeout"),
    }
    assert dispatched_limits == [100]
    assert len(global_timeout_calls) == 1
    form_id, workflow_run_id, node_id, task_session_maker = global_timeout_calls[0]
    assert form_id == "form-global"
    assert workflow_run_id == "run-global"
    assert node_id == "node-global"
    assert isinstance(task_session_maker, sessionmaker)
    assert task_session_maker.kw["bind"] is sqlite_engine
    sqlite_session.refresh(pause)
    assert pause.resume_requested_at is not None

    sqlite_session.expire_all()
    assert _require_form(sqlite_session, "form-global").status == HumanInputFormStatus.EXPIRED
    assert _require_form(sqlite_session, "form-node").status == HumanInputFormStatus.TIMEOUT
    assert _require_form(sqlite_session, "form-delivery").status == HumanInputFormStatus.TIMEOUT


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_orders_by_id_before_limit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)

    forms = [
        _build_form(
            form_id=form_id,
            form_kind=HumanInputFormKind.DELIVERY_TEST,
            created_at=now - timedelta(minutes=1),
            expiration_time=now - timedelta(seconds=1),
            workflow_run_id=None,
            node_id=f"node-{form_id}",
        )
        for form_id in ("form-b", "form-a")
    ]
    sqlite_session.add_all(forms)
    sqlite_session.commit()

    repo = HumanInputFormSubmissionRepository()
    mark_timeout_calls: list[tuple[str, HumanInputFormStatus, str | None, bool]] = []
    mark_timeout = repo.mark_timeout

    def record_mark_timeout(
        *,
        form_id: str,
        timeout_status: HumanInputFormStatus,
        reason: str | None = None,
        request_resume: bool = False,
    ) -> HumanInputFormRecord:
        mark_timeout_calls.append((form_id, timeout_status, reason, request_resume))
        return mark_timeout(
            form_id=form_id,
            timeout_status=timeout_status,
            reason=reason,
            request_resume=request_resume,
        )

    monkeypatch.setattr(repo, "mark_timeout", record_mark_timeout)
    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", lambda: repo)
    monkeypatch.setattr(task_module, "_dispatch_pending_human_input_resumes", lambda limit, workflow_run_id=None: None)
    monkeypatch.setattr(task_module, "_enqueue_human_input_v2_timeouts", lambda limit: None)

    task_module.check_and_handle_human_input_timeouts(limit=1)

    assert mark_timeout_calls == [("form-a", HumanInputFormStatus.TIMEOUT, "delivery_test_timeout", False)]
    sqlite_session.expire_all()
    assert _require_form(sqlite_session, "form-a").status == HumanInputFormStatus.TIMEOUT
    assert _require_form(sqlite_session, "form-b").status == HumanInputFormStatus.WAITING


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm, WorkflowPause)], indirect=True)
def test_node_timeout_without_pause_or_workflow_run_is_handled(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)
    sqlite_session.add_all(
        [
            _build_form(
                form_id="form-no-pause",
                form_kind=HumanInputFormKind.RUNTIME,
                created_at=now - timedelta(minutes=1),
                expiration_time=now - timedelta(seconds=1),
                workflow_run_id="run-without-pause",
                node_id="node-no-pause",
            ),
            _build_form(
                form_id="form-no-run",
                form_kind=HumanInputFormKind.RUNTIME,
                created_at=now - timedelta(minutes=1),
                expiration_time=now - timedelta(seconds=1),
                workflow_run_id=None,
                node_id="node-no-run",
            ),
        ]
    )
    sqlite_session.commit()
    monkeypatch.setattr(task_module, "_dispatch_pending_human_input_resumes", lambda _limit, workflow_run_id=None: None)
    monkeypatch.setattr(task_module, "_enqueue_human_input_v2_timeouts", lambda _limit: None)

    with caplog.at_level("WARNING", logger="tasks.human_input_timeout_tasks"):
        task_module.check_and_handle_human_input_timeouts(limit=10)

    sqlite_session.expire_all()
    assert _require_form(sqlite_session, "form-no-pause").status == HumanInputFormStatus.TIMEOUT
    assert _require_form(sqlite_session, "form-no-run").status == HumanInputFormStatus.TIMEOUT
    assert "form-no-run has no workflow_run_id; skipping resume" in caplog.text


@pytest.mark.parametrize("sqlite_session", [(HumanInputForm,)], indirect=True)
def test_check_and_handle_human_input_timeouts_omits_global_filter_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_task_database: None,
    sqlite_session: Session,
) -> None:
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    apply_config_overrides(monkeypatch, HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS=0)

    old_unexpired_form = _build_form(
        form_id="form-old",
        form_kind=HumanInputFormKind.RUNTIME,
        created_at=now - timedelta(hours=2),
        expiration_time=now + timedelta(hours=1),
        workflow_run_id="run-old",
        node_id="node-old",
    )
    sqlite_session.add(old_unexpired_form)
    sqlite_session.commit()

    repo = HumanInputFormSubmissionRepository()
    mark_timeout_calls: list[tuple[str, HumanInputFormStatus, str | None, bool]] = []
    mark_timeout = repo.mark_timeout

    def record_mark_timeout(
        *,
        form_id: str,
        timeout_status: HumanInputFormStatus,
        reason: str | None = None,
        request_resume: bool = False,
    ) -> HumanInputFormRecord:
        mark_timeout_calls.append((form_id, timeout_status, reason, request_resume))
        return mark_timeout(
            form_id=form_id,
            timeout_status=timeout_status,
            reason=reason,
            request_resume=request_resume,
        )

    global_timeout_calls: list[tuple[str, str, str, sessionmaker[Session]]] = []

    def record_global_timeout(
        *, form_id: str, workflow_run_id: str, node_id: str, session_factory: sessionmaker[Session]
    ) -> None:
        global_timeout_calls.append((form_id, workflow_run_id, node_id, session_factory))

    monkeypatch.setattr(repo, "mark_timeout", record_mark_timeout)
    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", lambda: repo)
    monkeypatch.setattr(task_module, "_dispatch_pending_human_input_resumes", lambda limit, workflow_run_id=None: None)
    monkeypatch.setattr(task_module, "_enqueue_human_input_v2_timeouts", lambda limit: None)
    monkeypatch.setattr(task_module, "_handle_global_timeout", record_global_timeout)

    task_module.check_and_handle_human_input_timeouts(limit=1)

    assert mark_timeout_calls == []
    assert global_timeout_calls == []
    sqlite_session.refresh(old_unexpired_form)
    assert old_unexpired_form.status == HumanInputFormStatus.WAITING
