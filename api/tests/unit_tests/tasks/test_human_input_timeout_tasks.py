from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from tasks import human_input_timeout_tasks as task_module


class _FakeScalarResult:
    def __init__(self, items: list[Any]):
        self._items = items

    def all(self) -> list[Any]:
        return self._items


class _FakeSession:
    def __init__(self, items: list[Any], capture: dict[str, Any]):
        self._items = items
        self._capture = capture

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def scalars(self, stmt):
        self._capture["stmt"] = stmt
        return _FakeScalarResult(self._items)


class _FakeSessionFactory:
    def __init__(self, items: list[Any], capture: dict[str, Any]):
        self._items = items
        self._capture = capture
        self._capture["session_factory"] = self

    def __call__(self):
        session = _FakeSession(self._items, self._capture)
        self._capture["session"] = session
        return session


class _FakeFormRepo:
    def __init__(self, _session_factory, form_map: dict[str, Any] | None = None):
        self.calls: list[dict[str, Any]] = []
        self._form_map = form_map or {}

    def mark_timeout(self, *, form_id: str, timeout_status: HumanInputFormStatus, reason: str | None = None):
        self.calls.append(
            {
                "form_id": form_id,
                "timeout_status": timeout_status,
                "reason": reason,
            }
        )
        form = self._form_map.get(form_id)
        return SimpleNamespace(
            form_id=form_id,
            workflow_run_id=getattr(form, "workflow_run_id", None),
            node_id=getattr(form, "node_id", None),
        )


class _FakeService:
    def __init__(self, _session_factory, form_repository=None):
        self.enqueued: list[str] = []

    def enqueue_resume(self, workflow_run_id: str | None) -> None:
        if workflow_run_id is not None:
            self.enqueued.append(workflow_run_id)


def _build_form(
    *,
    form_id: str,
    form_kind: HumanInputFormKind,
    created_at: datetime,
    expiration_time: datetime,
    workflow_run_id: str | None,
    node_id: str,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=form_id,
        form_kind=form_kind,
        created_at=created_at,
        expiration_time=expiration_time,
        workflow_run_id=workflow_run_id,
        node_id=node_id,
        status=HumanInputFormStatus.WAITING,
    )


def test_is_global_timeout_uses_created_at():
    now = datetime(2025, 1, 1, 12, 0, 0)
    form = SimpleNamespace(created_at=now - timedelta(seconds=61), workflow_run_id="run-1")

    assert task_module._is_global_timeout(form, 60, now=now) is True

    form.workflow_run_id = None
    assert task_module._is_global_timeout(form, 60, now=now) is False

    form.workflow_run_id = "run-1"
    form.created_at = now - timedelta(seconds=59)
    assert task_module._is_global_timeout(form, 60, now=now) is False

    assert task_module._is_global_timeout(form, 0, now=now) is False


def test_check_and_handle_human_input_timeouts_marks_and_routes(monkeypatch: pytest.MonkeyPatch):
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    monkeypatch.setattr(task_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 3600)
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=object()))

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

    capture: dict[str, Any] = {}
    monkeypatch.setattr(task_module, "sessionmaker", lambda *args, **kwargs: _FakeSessionFactory(forms, capture))

    form_map = {form.id: form for form in forms}
    repo = _FakeFormRepo(None, form_map=form_map)

    def _repo_factory(_session_factory):
        return repo

    service = _FakeService(None)

    def _service_factory(_session_factory, form_repository=None):
        return service

    global_calls: list[dict[str, Any]] = []

    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", _repo_factory)
    monkeypatch.setattr(task_module, "HumanInputService", _service_factory)
    monkeypatch.setattr(task_module, "_handle_global_timeout", lambda **kwargs: global_calls.append(kwargs))

    task_module.check_and_handle_human_input_timeouts(limit=100)

    assert {(call["form_id"], call["timeout_status"], call["reason"]) for call in repo.calls} == {
        ("form-global", HumanInputFormStatus.EXPIRED, "global_timeout"),
        ("form-node", HumanInputFormStatus.TIMEOUT, "node_timeout"),
        ("form-delivery", HumanInputFormStatus.TIMEOUT, "delivery_test_timeout"),
    }
    assert service.enqueued == ["run-node"]
    assert global_calls == [
        {
            "form_id": "form-global",
            "workflow_run_id": "run-global",
            "node_id": "node-global",
            "session_factory": capture.get("session_factory"),
        }
    ]

    stmt = capture.get("stmt")
    assert stmt is not None
    stmt_text = str(stmt)
    assert "created_at <=" in stmt_text
    assert "expiration_time <=" in stmt_text
    assert "ORDER BY human_input_forms.id" in stmt_text


def test_check_and_handle_human_input_timeouts_omits_global_filter_when_disabled(monkeypatch: pytest.MonkeyPatch):
    now = datetime(2025, 1, 1, 12, 0, 0)
    monkeypatch.setattr(task_module, "naive_utc_now", lambda: now)
    monkeypatch.setattr(task_module.dify_config, "HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=object()))

    capture: dict[str, Any] = {}
    monkeypatch.setattr(task_module, "sessionmaker", lambda *args, **kwargs: _FakeSessionFactory([], capture))
    monkeypatch.setattr(task_module, "HumanInputFormSubmissionRepository", _FakeFormRepo)
    monkeypatch.setattr(task_module, "HumanInputService", _FakeService)
    monkeypatch.setattr(task_module, "_handle_global_timeout", lambda **_kwargs: None)

    task_module.check_and_handle_human_input_timeouts(limit=1)

    stmt = capture.get("stmt")
    assert stmt is not None
    stmt_text = str(stmt)
    assert "created_at <=" not in stmt_text
