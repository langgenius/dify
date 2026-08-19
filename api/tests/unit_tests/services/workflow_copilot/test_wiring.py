import dataclasses
from unittest.mock import patch

from core.workflow_copilot.errors import BusyError, ConflictError, NotFoundError
from core.workflow_copilot.models import Action, Actor
from services.workflow_copilot import wiring
from services.workflow_copilot.service import SessionView


def test_session_view_to_dict_round_trips_fields():
    view = SessionView(
        session_id="s1", app_id="a1", version=3, state="fix.await_verify",
        canvas_read_only=False, run_status="waiting-input", interrupted=False,
        conversation=[],
    )
    d = wiring.session_view_to_dict(view)
    assert d == {
        "session_id": "s1", "app_id": "a1", "version": 3, "state": "fix.await_verify",
        "canvas_read_only": False, "run_status": "waiting-input", "interrupted": False,
        "conversation": [],
    }


def test_error_map():
    assert wiring.copilot_error_response(NotFoundError("x"))[1] == 404
    assert wiring.copilot_error_response(NotFoundError("x"))[0]["code"] == "not_found"
    assert wiring.copilot_error_response(ConflictError("x")) == ({"code": "conflict"}, 409)
    assert wiring.copilot_error_response(BusyError("x")) == ({"code": "session_busy"}, 409)
    assert wiring.copilot_error_response(ValueError("x")) is None  # unknown → caller re-raises


def test_build_service_enqueue_calls_delay_with_dicts():
    with patch("services.workflow_copilot.wiring.advance_session") as task, \
         patch("services.workflow_copilot.wiring.db"):
        svc = wiring.build_service()
        action = Action(kind="run_verify", base_version=2)
        actor = Actor(account_id="acc", tenant_id="ten")
        svc._enqueue_fn("sid-1", action, actor, "tok-9")  # the injected enqueue
    task.delay.assert_called_once_with(
        "sid-1", dataclasses.asdict(action), dataclasses.asdict(actor), "tok-9"
    )
