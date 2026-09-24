import dataclasses
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.common.rbac import PlainApp, RBACPermission
from core.dify_builder.errors import BusyError, ConflictError, ModelUnavailableError, NotFoundError
from core.dify_builder.models import Action, Actor
from models import TenantAccountRole
from services.dify_builder import wiring
from services.dify_builder.service import AppAccess, SessionView


def test_session_view_to_dict_projects_only_browser_fields():
    view = SessionView(
        session_id="s1",
        app_id="a1",
        version=3,
        state="fix.await_verify",
        canvas_read_only=False,
        run_status="waiting_input",
        interrupted=False,
        conversation_last_seq=7,
    )
    d = wiring.session_view_to_dict(view)
    assert d == {
        "session_id": "s1",
        "version": 3,
        "canvas_read_only": False,
        "run_status": "waiting_input",
        "interrupted": False,
        "conversation_last_seq": 7,
        "last_command_id": "",
        "phase": "understand",
        "actions": [],
    }


def test_public_session_projection_exposes_decision_and_strips_internal_revision_fields():
    decision = {
        "title": "What should Builder do next?",
        "description": "Choose one option to continue.",
        "options": [
            {
                "id": "approve_plan",
                "label": "Approve plan",
                "kind": "primary",
                "is_default": True,
            }
        ],
        "submit": {"id": "confirm", "label": "Submit", "kind": "primary"},
        "default_option_id": "approve_plan",
    }
    projected = wiring._public_session_view(
        {
            "session_id": "s1",
            "app_id": "a1",
            "version": 4,
            "state": "build.goal_analysis",
            "entry_mode": "build",
            "canvas_read_only": False,
            "run_status": "waiting_input",
            "interrupted": False,
            "conversation_last_seq": 8,
            "phase": "clarify",
            "actions": [
                {
                    "id": "submit_requirements",
                    "label": "Submit",
                    "kind": "primary",
                    "next_state": "build.resources",
                    "canvas_event": "apply_edit_plan",
                }
            ],
            "active_interaction": {
                "action_id": "submit_requirements",
                "card": {"seq": 8, "kind": "form", "payload": {}},
                "valid_at_version": 4,
            },
            "app_revision": {"observed": "old", "current": "new", "conflicted": True},
            "decision": decision,
            "checkpoint": {"id": "checkpoint-1"},
        },
        include_last_command_id=False,
    )

    assert projected == {
        "session_id": "s1",
        "version": 4,
        "canvas_read_only": False,
        "run_status": "waiting_input",
        "interrupted": False,
        "conversation_last_seq": 8,
        "phase": "clarify",
        "actions": [{"id": "submit_requirements", "label": "Submit", "kind": "primary"}],
        "active_interaction": {
            "action_id": "submit_requirements",
            "card_seq": 8,
            "valid_at_version": 4,
        },
        "app_revision": {"current": "new", "conflicted": True},
        "decision": decision,
    }


def test_error_map():
    assert wiring.dify_builder_error_response(ModelUnavailableError("private provider detail")) == (
        {"code": "model_unavailable", "message": "Builder model is unavailable", "recoverable": True},
        400,
    )
    assert wiring.dify_builder_error_response(NotFoundError("x"))[1] == 404
    assert wiring.dify_builder_error_response(NotFoundError("x"))[0]["code"] == "not_found"
    assert wiring.dify_builder_error_response(ConflictError("x")) == ({"code": "conflict"}, 409)
    assert wiring.dify_builder_error_response(BusyError("x")) == ({"code": "session_busy"}, 409)
    assert wiring.dify_builder_error_response(ValueError("x")) is None  # unknown → caller re-raises


def test_build_service_enqueue_calls_delay_with_dicts():
    with patch("services.dify_builder.wiring.advance_session") as task, patch("services.dify_builder.wiring.db"):
        svc = wiring.build_service()
        action = Action(kind="run_verify", base_version=2)
        actor = Actor(account_id="acc", tenant_id="ten")
        assert svc._authorize_app_fn is wiring._authorize_app
        svc._enqueue_fn("sid-1", action, actor, "tok-9")  # the injected enqueue
    task.delay.assert_called_once_with("sid-1", dataclasses.asdict(action), dataclasses.asdict(actor), "tok-9")


def test_authorize_app_legacy_requires_tenant_editor_role(monkeypatch: pytest.MonkeyPatch):
    scalar = MagicMock(side_effect=["app-1", TenantAccountRole.EDITOR])
    monkeypatch.setattr(wiring.db.session, "scalar", scalar)
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", False)
    enforce = MagicMock()
    monkeypatch.setattr(wiring, "enforce_rbac_checks", enforce)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)

    enforce.assert_called_once_with(
        tenant_id="ten-1",
        account_id="acc-1",
        checks=enforce.call_args.kwargs["checks"],
        path_args={"app_id": "app-1"},
    )
    check = enforce.call_args.kwargs["checks"][0]
    assert check.scene is RBACPermission.APP_EDIT
    assert isinstance(check.locator, PlainApp)


def test_authorize_app_legacy_rejects_non_editor(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        wiring.db.session,
        "scalar",
        MagicMock(side_effect=["app-1", TenantAccountRole.NORMAL]),
    )
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", False)

    with pytest.raises(Forbidden):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)


@pytest.mark.parametrize(
    ("access", "scenes"),
    [
        (AppAccess.EDIT, [RBACPermission.APP_EDIT]),
        (AppAccess.TEST_AND_RUN, [RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN]),
        (AppAccess.RELEASE, [RBACPermission.APP_EDIT, RBACPermission.APP_RELEASE_AND_VERSION]),
    ],
)
def test_authorize_app_rbac_enforces_base_and_operation_permission(
    monkeypatch: pytest.MonkeyPatch, access: AppAccess, scenes: list[RBACPermission]
) -> None:
    monkeypatch.setattr(
        wiring.db.session,
        "scalar",
        MagicMock(side_effect=["app-1", TenantAccountRole.NORMAL]),
    )
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)
    enforce = MagicMock()
    monkeypatch.setattr(wiring, "enforce_rbac_checks", enforce)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", access)

    assert [item.kwargs["checks"][0].scene for item in enforce.call_args_list] == scenes
    assert all(isinstance(item.kwargs["checks"][0].locator, PlainApp) for item in enforce.call_args_list)
    assert all(
        item.kwargs["tenant_id"] == "ten-1"
        and item.kwargs["account_id"] == "acc-1"
        and item.kwargs["path_args"] == {"app_id": "app-1"}
        for item in enforce.call_args_list
    )


def test_authorize_app_rejects_missing_or_foreign_app(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(wiring.db.session, "scalar", MagicMock(return_value=None))

    with pytest.raises(NotFoundError, match="app not found"):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)


def test_authorize_app_rejects_account_outside_tenant(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(wiring.db.session, "scalar", MagicMock(side_effect=["app-1", None]))
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)

    with pytest.raises(Forbidden):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)
