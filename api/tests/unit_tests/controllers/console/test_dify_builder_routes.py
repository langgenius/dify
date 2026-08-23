"""Unit tests for the Dify Builder console JSON routes.

These test the UNDECORATED module-level route-logic functions
(``_create``/``_view``/``_action``/``_message``) and the ``dify_builder_required``
gate directly -- NOT the decorated ``Resource`` methods. Calling a decorated
resource method would trigger the real ``@login_required``/``@setup_required``
auth stack, which needs a live Flask request context and a logged-in user;
that is exercised by integration/e2e tests, not here.
"""

from unittest.mock import MagicMock

import controllers.console.dify_builder as mod
from controllers.console import wraps as wraps_mod
from core.dify_builder.errors import BusyError, ConflictError, NotFoundError
from core.dify_builder.models import Actor
from services.dify_builder.service import SessionView


def _session_view(session_id: str = "s1") -> SessionView:
    return SessionView(
        session_id=session_id,
        app_id="a1",
        version=1,
        state="fix.diagnose",
        canvas_read_only=True,
        run_status="executing",
        interrupted=False,
        conversation=[],
    )


def _account(account_id: str = "acc-1") -> MagicMock:
    m = MagicMock()
    m.id = account_id
    return m


def _actor() -> Actor:
    return mod._actor(_account(), "ten-1")


def test_actor_builds_from_current_user_and_tenant():
    account = _account("acc-1")
    actor = mod._actor(account, "ten-1")
    assert actor == Actor(account_id="acc-1", tenant_id="ten-1")


def test_create_returns_201_and_view(monkeypatch):
    svc = MagicMock()
    svc.create_fix_session.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: svc)

    actor = _actor()
    body, status = mod._create({"app_id": "a1", "failed_run_id": "TR-1", "checklist_errors": []}, actor)

    assert status == 201
    assert body["session_id"] == "s1"
    called = svc.create_fix_session.call_args
    assert called.kwargs["app_id"] == "a1"
    assert isinstance(called.kwargs["actor"], Actor)
    assert called.kwargs["actor"] == actor


def test_create_build_scenario_calls_create_build_session(monkeypatch):
    svc = MagicMock()
    svc.create_build_session.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._create({"scenario": "build", "app_id": "a1", "goal_text": "Build it"}, actor)

    assert status == 201
    svc.create_build_session.assert_called_once()
    called = svc.create_build_session.call_args
    assert called.kwargs["app_id"] == "a1"
    assert called.kwargs["goal_text"] == "Build it"
    svc.create_fix_session.assert_not_called()


def test_create_edit_scenario_calls_create_edit_session(monkeypatch):
    svc = MagicMock()
    svc.create_edit_session.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._create({"scenario": "edit", "app_id": "a1"}, actor)

    assert status == 201
    svc.create_edit_session.assert_called_once()
    called = svc.create_edit_session.call_args
    assert called.kwargs["app_id"] == "a1"
    svc.create_fix_session.assert_not_called()
    svc.create_build_session.assert_not_called()


def test_create_rejects_non_dict_body():
    actor = _actor()
    svc = MagicMock()
    body, status = mod._create(None, actor)
    assert (body, status) == ({"code": "bad_request"}, 400)
    svc.create_fix_session.assert_not_called()


def test_action_rejects_non_dict_body(monkeypatch):
    svc = MagicMock()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._action("s1", "notadict", actor)

    assert (body, status) == ({"code": "bad_request"}, 400)
    svc.submit_action.assert_not_called()


def test_action_conflict_maps_409(monkeypatch):
    svc = MagicMock()
    svc.submit_action.side_effect = ConflictError("stale")
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._action("s1", {"kind": "run_verify", "payload": {}, "base_version": 1}, actor)

    assert status == 409
    assert body["code"] == "conflict"


def test_action_resolves_action_id_to_handler_kind(monkeypatch):
    svc = MagicMock()
    svc.submit_action.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._action("s1", {"action_id": "run_validation", "payload": {}, "base_version": 1}, actor)

    assert status == 200
    called_action = svc.submit_action.call_args.args[2]
    assert called_action.kind == "run_verify"


def test_action_id_supersedes_legacy_kind_when_both_present(monkeypatch):
    svc = MagicMock()
    svc.submit_action.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._action(
        "s1", {"action_id": "publish_fix", "kind": "run_verify", "payload": {}, "base_version": 1}, actor
    )

    assert status == 200
    called_action = svc.submit_action.call_args.args[2]
    assert called_action.kind == "publish"


def test_action_legacy_kind_still_accepted_without_action_id(monkeypatch):
    svc = MagicMock()
    svc.submit_action.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._action("s1", {"kind": "run_verify", "payload": {}, "base_version": 1}, actor)

    assert status == 200
    called_action = svc.submit_action.call_args.args[2]
    assert called_action.kind == "run_verify"


def test_action_busy_maps_409_session_busy(monkeypatch):
    svc = MagicMock()
    svc.submit_action.side_effect = BusyError("busy")
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._action("s1", {"kind": "publish", "payload": {}, "base_version": 2}, actor)

    assert status == 409
    assert body["code"] == "session_busy"


def test_view_notfound_maps_generic_404(monkeypatch):
    svc = MagicMock()
    svc.get_session_view.side_effect = NotFoundError("session xyz not found")
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._view("s1", actor)

    assert status == 404
    assert body == {"code": "not_found"}
    # the message text must NOT leak into the response
    assert "xyz" not in str(body)


def test_message_returns_200_and_view(monkeypatch):
    svc = MagicMock()
    svc.submit_message.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._message("s1", {"text": "hi", "base_version": 2}, actor)

    assert status == 200
    assert body["session_id"] == "s1"
    svc.submit_message.assert_called_once_with("s1", actor, "hi", 2)


def test_message_rejects_non_dict_body(monkeypatch):
    svc = MagicMock()
    monkeypatch.setattr(mod, "build_service", lambda: svc)
    actor = _actor()

    body, status = mod._message("s1", None, actor)

    assert (body, status) == ({"code": "bad_request"}, 400)
    svc.submit_message.assert_not_called()


# --- dify_builder_required gate -----------------------------------------
#
# NOTE: the brief/dispatch assumed `@with_current_user`/`@with_current_tenant_id`
# inject their values as KEYWORD arguments. Reading the real implementation in
# controllers/console/wraps.py shows otherwise: both call
# `view(self, injected_value, *args, **kwargs)`, i.e. they PREPEND the value as
# a POSITIONAL argument immediately after `self`. This is confirmed by the
# existing multi-decorator example in controllers/console/app/workflow_comment.py
# (`def post(self, current_tenant_id, current_user, app_model, comment_id)`).
# `dify_builder_required` sits directly below `@with_current_tenant_id`, so
# it must accept `current_tenant_id` positionally (as the argument right after
# `self`), not as a keyword-only argument. The gate is tested against that real
# contract below.


def test_dify_builder_required_blocks_when_feature_disabled(monkeypatch):
    def dummy(_self, _current_tenant_id, *_args, **_kwargs):
        return {"ok": True}, 200

    wrapped = mod.dify_builder_required(dummy)

    features = MagicMock()
    features.dify_builder_enabled = False
    monkeypatch.setattr(mod.FeatureService, "get_features", lambda _tenant_id: features)

    result = wrapped(object(), "t")

    assert result == ({"code": "feature_unavailable"}, 403)


def test_dify_builder_required_passes_through_when_enabled(monkeypatch):
    def dummy(_self, current_tenant_id, *_args, **_kwargs):
        return {"ok": True, "current_tenant_id": current_tenant_id}, 200

    wrapped = mod.dify_builder_required(dummy)

    features = MagicMock()
    features.dify_builder_enabled = True
    monkeypatch.setattr(mod.FeatureService, "get_features", lambda _tenant_id: features)

    result = wrapped(object(), "t")

    assert result == ({"ok": True, "current_tenant_id": "t"}, 200)


# --- real decorator stack composition ---------------------------------------
#
# The tests above exercise `dify_builder_required` in isolation. The tests
# below compose the REAL `@with_current_user` / `@with_current_tenant_id` /
# `dify_builder_required` stack (mirroring the exact nesting used on the
# Resource methods in dify_builder.py: `with_current_user(with_current_tenant_id(
# dify_builder_required(view)))`) to verify the values actually land in the
# method's declared positional slots -- not just that each decorator behaves
# correctly alone.


def test_decorator_stack_injects_positionally_in_method_order(monkeypatch):
    account = MagicMock()
    account.id = "acc-1"
    # both injection decorators resolve identity via current_account_with_tenant()
    monkeypatch.setattr(wraps_mod, "current_account_with_tenant", lambda: (account, "ten-9"))
    # feature enabled so the gate passes through instead of 403
    feat = MagicMock()
    feat.dify_builder_enabled = True
    monkeypatch.setattr(mod, "FeatureService", MagicMock(get_features=lambda _t: feat))

    captured = {}

    def fake_view(self, current_tenant_id, current_user, **kwargs):
        captured.update(
            self=self, current_tenant_id=current_tenant_id, current_user=current_user, kwargs=kwargs
        )
        return {"ok": True}, 200

    # innermost → outermost, mirroring the real stack order (gate is closest to the method)
    composed = wraps_mod.with_current_user(
        wraps_mod.with_current_tenant_id(mod.dify_builder_required(fake_view))
    )
    sentinel_self = object()
    result = composed(sentinel_self, session_id="s1")

    assert result == ({"ok": True}, 200)
    assert captured["self"] is sentinel_self
    assert captured["current_tenant_id"] == "ten-9"
    assert captured["current_user"] is account
    assert captured["kwargs"] == {"session_id": "s1"}


def test_decorator_stack_gate_blocks_when_feature_off(monkeypatch):
    account = MagicMock()
    account.id = "acc-1"
    monkeypatch.setattr(wraps_mod, "current_account_with_tenant", lambda: (account, "ten-9"))
    feat = MagicMock()
    feat.dify_builder_enabled = False
    monkeypatch.setattr(mod, "FeatureService", MagicMock(get_features=lambda _t: feat))

    def fake_view(_self, _current_tenant_id, _current_user, **_kwargs):
        raise AssertionError("view must not run when the feature is off")

    composed = wraps_mod.with_current_user(
        wraps_mod.with_current_tenant_id(mod.dify_builder_required(fake_view))
    )
    result = composed(object(), session_id="s1")
    assert result == ({"code": "feature_unavailable"}, 403)
