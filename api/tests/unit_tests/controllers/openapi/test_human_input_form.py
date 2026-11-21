"""Tests for openapi human input form endpoints.

Auth is not exercised here: `@endpoint` resolves the `Context` before the handler
runs, and the allow/deny answers live in `test_auth_matrix.py`. The recipient-surface
refusal is `CheckFormSurface`'s — a `Requirement` this feature owns rather than the
auth layer, so it is pinned here too. Body tests call `__handler__` — the one seam —
with a `Context` double. The submit route's 422 goes over the wire instead,
in the shared table in `test_workspaces_members.py`.
"""

from __future__ import annotations

import json
import sys
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Concatenate, cast
from unittest.mock import Mock

import pytest
from flask import Flask
from jsonschema import Draft202012Validator

from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import build_catalog
from controllers.openapi._contract import op_of
from controllers.openapi._errors import HumanInputFormNotFound, RecipientSurfaceMismatch
from controllers.openapi._models import FormSubmitResponse, OpenApiFormSubmitPayload
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import Rank
from controllers.openapi.auth.subjects import Subject
from controllers.openapi.human_input_form import (
    CheckFormSurface,
    OpenApiWorkflowHumanInputFormApi,
    OpenApiWorkflowHumanInputFormSubmitApi,
    with_form_hints,
)
from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi
from core.app.entities.task_entities import HumanInputRequiredResponse
from core.workflow.nodes.human_input import FormInputConfig, ParagraphInputConfig, UserActionConfig
from models.account import Account
from models.enums import CreatorUserRole, EndUserType
from models.human_input import RecipientType
from models.model import App, AppMode, EndUser

_MODULE = "controllers.openapi.human_input_form"


def _context(caller: Account | EndUser, caller_role: CreatorUserRole) -> Context:
    """A store already filled the way the route's requirements would have filled it."""
    ctx = Context(
        cast(Subject, SimpleNamespace(caller_role=caller_role)),
        Mock(),
        {"app_id": "app-1", "form_token": "tok-1"},
    )
    ctx._app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Human input app",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
    )
    ctx._caller = caller
    return ctx


def _handler[**P, R](api: object, method: str) -> Callable[Concatenate[object, P], R]:
    """Return the undecorated view `@endpoint` stashed on the decorated one.

    `_contract.py` attaches `__handler__` at decoration time, so it is absent from
    the wrapped function's static type; reading it out of the attribute dict keeps
    the access honest instead of suppressing the diagnostic. `Concatenate[object, P]`
    carries the instance the view is called with, mirroring how the decorator stores
    an unbound function.
    """
    view = type(api).__dict__[method]
    handler: object = vars(view)["__handler__"]
    assert callable(handler)
    return handler


def _mock_service(monkeypatch: pytest.MonkeyPatch, form: SimpleNamespace | None) -> Mock:
    """Bind a mocked `HumanInputService` into the module."""
    service_mock = Mock()
    service_mock.get_form_by_token.return_value = form
    module = sys.modules[_MODULE]
    monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
    return service_mock


def _make_form(
    app_id: str = "app-1",
    recipient_type: RecipientType | None = RecipientType.STANDALONE_WEB_APP,
    workflow_run_id: str | None = None,
) -> SimpleNamespace:
    form = SimpleNamespace(
        app_id=app_id,
        tenant_id="tenant-1",
        recipient_type=recipient_type,
        expiration_time=datetime(2099, 1, 1, tzinfo=UTC),
    )
    form.workflow_run_id = workflow_run_id
    return form


def _make_account(account_id: str = "acct-1") -> Account:
    account = Account(name="Human Input User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_end_user(end_user_id: str = "eu-1") -> EndUser:
    return EndUser(
        id=end_user_id,
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.OPENAPI,
        session_id=f"session-{end_user_id}",
    )


class TestOpenApiHumanInputFormGet:
    def test_get_success(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        definition = SimpleNamespace(
            model_dump=lambda: {
                "rendered_content": "Fill out the form",
                "inputs": [{"output_variable_name": "field1"}],
                "default_values": {"field1": "default"},
                "user_actions": [{"id": "submit", "title": "Submit"}],
            }
        )
        form = _make_form()
        form.get_definition = lambda: definition
        service_mock = _mock_service(monkeypatch, form)

        api = OpenApiWorkflowHumanInputFormApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/tok-1"):
            resp = _handler(api, "get")(
                api,
                _context(_make_account(), CreatorUserRole.ACCOUNT),
                app_id="app-1",
                form_token="tok-1",
            )

        payload = json.loads(resp.get_data(as_text=True))
        assert payload["form_content"] == "Fill out the form"
        assert payload["resolved_default_values"] == {"field1": "default"}
        assert payload["user_actions"] == [{"id": "submit", "title": "Submit"}]
        service_mock.ensure_form_active.assert_called_once_with(form)

    def test_get_form_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        _mock_service(monkeypatch, None)

        api = OpenApiWorkflowHumanInputFormApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/bad"):
            with pytest.raises(HumanInputFormNotFound):
                _handler(api, "get")(
                    api,
                    _context(_make_account(), CreatorUserRole.ACCOUNT),
                    app_id="app-1",
                    form_token="bad",
                )

    def test_get_form_wrong_app(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        _mock_service(monkeypatch, _make_form(app_id="other-app"))

        api = OpenApiWorkflowHumanInputFormApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/tok-1"):
            with pytest.raises(HumanInputFormNotFound):
                _handler(api, "get")(
                    api,
                    _context(_make_account(), CreatorUserRole.ACCOUNT),
                    app_id="app-1",
                    form_token="tok-1",
                )


class TestOpenApiHumanInputFormPost:
    def test_post_account_caller_uses_user_id(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        service_mock = _mock_service(monkeypatch, _make_form())

        api = OpenApiWorkflowHumanInputFormSubmitApi()
        with app.test_request_context(
            "/openapi/v1/apps/app-1/human-input-forms/tok-1:submit",
            method="POST",
            json={"action": "approve", "inputs": {"field1": "val"}},
        ):
            result = _handler(api, "post")(
                api,
                _context(_make_account("acct-42"), CreatorUserRole.ACCOUNT),
                app_id="app-1",
                form_token="tok-1",
                body=OpenApiFormSubmitPayload(action="approve", inputs={"field1": "val"}),
            )

        service_mock.submit_form_by_token.assert_called_once_with(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="tok-1",
            selected_action_id="approve",
            form_data={"field1": "val"},
            submission_user_id="acct-42",
            submission_end_user_id=None,
        )
        assert result == FormSubmitResponse()

    def test_post_end_user_caller_uses_end_user_id(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        service_mock = _mock_service(monkeypatch, _make_form())

        api = OpenApiWorkflowHumanInputFormSubmitApi()
        with app.test_request_context(
            "/openapi/v1/apps/app-1/human-input-forms/tok-1:submit",
            method="POST",
            json={"action": "approve", "inputs": {}},
        ):
            result = _handler(api, "post")(
                api,
                _context(_make_end_user("eu-7"), CreatorUserRole.END_USER),
                app_id="app-1",
                form_token="tok-1",
                body=OpenApiFormSubmitPayload(action="approve", inputs={}),
            )

        service_mock.submit_form_by_token.assert_called_once_with(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="tok-1",
            selected_action_id="approve",
            form_data={},
            submission_user_id=None,
            submission_end_user_id="eu-7",
        )
        assert result == FormSubmitResponse()


class TestSubmitFollowRunHint:
    def _submit(
        self, app: Flask, monkeypatch: pytest.MonkeyPatch, *, workflow_run_id: str | None
    ) -> FormSubmitResponse:
        _mock_service(monkeypatch, _make_form(workflow_run_id=workflow_run_id))
        api = OpenApiWorkflowHumanInputFormSubmitApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/tok-1:submit", method="POST"):
            return _handler(api, "post")(
                api,
                _context(_make_account(), CreatorUserRole.ACCOUNT),
                app_id="app-1",
                form_token="tok-1",
                body=OpenApiFormSubmitPayload(action="approve", inputs={}),
            )

    def test_hints_following_the_run_the_form_paused(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        result = self._submit(app, monkeypatch, workflow_run_id="run-9")

        [hint] = result.hints
        assert hint.op == op_of(OpenApiWorkflowEventsApi.get) == "get.run.event"
        assert hint.input == {
            "app_id": "app-1",
            "run_id": "run-9",
            "include_state_snapshot": True,
            "continue_on_pause": False,
        }

    def test_hint_input_passes_the_events_op_input_schema(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        [hint] = self._submit(app, monkeypatch, workflow_run_id="run-9").hints

        catalog_app = Flask(__name__)
        catalog_app.register_blueprint(openapi_bp)
        schema = build_catalog(catalog_app)["ops"][hint.op]["input"]
        validator = Draft202012Validator({**schema, "additionalProperties": False})
        assert [err.message for err in validator.iter_errors(hint.input)] == []

    def test_no_hint_without_a_run(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        assert self._submit(app, monkeypatch, workflow_run_id=None).hints == []


@pytest.mark.parametrize(
    "view",
    [OpenApiWorkflowHumanInputFormApi.get, OpenApiWorkflowHumanInputFormSubmitApi.post],
    ids=["get", "submit"],
)
def test_both_routes_declare_the_surface_check_last_at_the_default_rank(view: Callable[..., object]) -> None:
    """The wiring, not the requirement's own logic: `CheckFormSurface` only runs
    on a route that declares it, and the allow/deny matrix has no console-recipient
    case, so removing either declaration changes no row there. It carries no rank
    of its own, so declaration order is what keeps it last.
    """
    spec = vars(view)["__spec__"]
    assert isinstance(spec.requirements[-1], CheckFormSurface)
    assert CheckFormSurface.rank is Rank.NORMAL


class TestCheckFormSurface:
    """The refusal itself. Declared last at both routes, so it answers before
    the handler body runs.
    """

    def _run(self, monkeypatch: pytest.MonkeyPatch, form: SimpleNamespace | None) -> None:
        _mock_service(monkeypatch, form)
        ctx = _context(_make_account(), CreatorUserRole.ACCOUNT)
        CheckFormSurface().run(ctx.subject, ctx, Mock())

    def test_admits_a_web_app_recipient(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._run(monkeypatch, _make_form(recipient_type=RecipientType.STANDALONE_WEB_APP))

    @pytest.mark.parametrize("recipient_type", [RecipientType.CONSOLE, RecipientType.BACKSTAGE, None])
    def test_refuses_a_recipient_this_surface_may_not_act_on(
        self, monkeypatch: pytest.MonkeyPatch, recipient_type: RecipientType | None
    ) -> None:
        with pytest.raises(RecipientSurfaceMismatch):
            self._run(monkeypatch, _make_form(recipient_type=recipient_type))

    @pytest.mark.parametrize("form", [None, "foreign"])
    def test_leaves_a_form_the_caller_could_not_have_found_to_the_handlers_404(
        self, monkeypatch: pytest.MonkeyPatch, form: str | None
    ) -> None:
        """Answering 403 on a console-bound form in another app would confirm the
        token exists; the handler's own 404 owns both cases.
        """
        foreign = _make_form(app_id=str(uuid.uuid4()), recipient_type=RecipientType.CONSOLE)
        self._run(monkeypatch, foreign if form == "foreign" else None)


def _paused(
    *, form_token: str | None, inputs: list[FormInputConfig], actions: list[UserActionConfig]
) -> dict[str, object]:
    response = HumanInputRequiredResponse(
        task_id="t1",
        workflow_run_id="r1",
        data=HumanInputRequiredResponse.Data(
            form_id="f1",
            node_id="n1",
            node_title="Review",
            form_content="",
            inputs=inputs,
            actions=actions,
            form_token=form_token,
            expiration_time=4102444800,
        ),
    )
    return response.model_dump(mode="json")


class TestFormHints:
    def test_with_form_hints_adds_one_hint_per_action_targeting_the_submit_route(self) -> None:
        event = _paused(
            form_token="ft-1",
            inputs=[ParagraphInputConfig(output_variable_name="comment")],
            actions=[UserActionConfig(id="approve", title="批准"), UserActionConfig(id="reject", title="")],
        )
        [out] = list(with_form_hints(iter([f"data: {json.dumps(event)}\n\n"]), app_id="a1"))
        body = json.loads(out[len("data: ") :])
        data = event["data"]
        assert isinstance(data, dict)
        form_inputs = data["inputs"]
        op = op_of(OpenApiWorkflowHumanInputFormSubmitApi.post)
        assert op == "submit.run.form"
        assert body["hints"] == [
            {
                "summary": "批准",
                "op": op,
                "input": {"app_id": "a1", "form_token": "ft-1", "action": "approve", "inputs": {"comment": None}},
                "form": form_inputs,
            },
            {
                "summary": "reject",
                "op": op,
                "input": {"app_id": "a1", "form_token": "ft-1", "action": "reject", "inputs": {"comment": None}},
                "form": form_inputs,
            },
        ]
