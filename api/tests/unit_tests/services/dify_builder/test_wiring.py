import dataclasses
from unittest.mock import MagicMock, call, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.common.wraps import RBACPermission, RBACResourceScope
from core.dify_builder.errors import BusyError, ConflictError, NotFoundError
from core.dify_builder.models import Action, Actor
from models import TenantAccountRole
from services.dify_builder import wiring
from services.dify_builder.service import AppAccess, SessionView


def test_session_view_to_dict_round_trips_fields():
    view = SessionView(
        session_id="s1",
        app_id="a1",
        version=3,
        state="fix.await_verify",
        # "waiting-input" (hyphen) is a raw passthrough literal for this
        # asdict round-trip test, not real service output -- _run_status
        # never returns this; the real widened value is "waiting_input".
        canvas_read_only=False,
        run_status="waiting-input",
        interrupted=False,
        conversation_last_seq=7,
    )
    d = wiring.session_view_to_dict(view)
    assert d == {
        "session_id": "s1",
        "app_id": "a1",
        "version": 3,
        "state": "fix.await_verify",
        "canvas_read_only": False,
        "run_status": "waiting-input",
        "interrupted": False,
        "conversation_last_seq": 7,
        "entry_mode": "fix",
        "phase": "understand",
        "actions": [],
        "active_interaction": None,
        "checkpoint": None,
        "recovery": None,
        "model": None,
        "app_revision": None,
    }


def test_error_map():
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
    monkeypatch.setattr(wiring, "enforce_rbac_access", enforce)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)

    enforce.assert_called_once_with(
        tenant_id="ten-1",
        account_id="acc-1",
        resource_type=RBACResourceScope.APP,
        scene=RBACPermission.APP_EDIT,
        path_args={"app_id": "app-1"},
    )


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
    monkeypatch.setattr(wiring, "enforce_rbac_access", enforce)

    wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", access)

    assert enforce.call_args_list == [
        call(
            tenant_id="ten-1",
            account_id="acc-1",
            resource_type=RBACResourceScope.APP,
            scene=scene,
            path_args={"app_id": "app-1"},
        )
        for scene in scenes
    ]


def test_authorize_app_rejects_missing_or_foreign_app(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(wiring.db.session, "scalar", MagicMock(return_value=None))

    with pytest.raises(NotFoundError, match="app not found"):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)


def test_authorize_app_rejects_account_outside_tenant(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(wiring.db.session, "scalar", MagicMock(side_effect=["app-1", None]))
    monkeypatch.setattr(wiring.dify_config, "RBAC_ENABLED", True)

    with pytest.raises(Forbidden):
        wiring._authorize_app(Actor(account_id="acc-1", tenant_id="ten-1"), "app-1", AppAccess.EDIT)
