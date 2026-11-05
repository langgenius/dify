"""`describe.run.form` and `submit.run.form` on a Human Input v2 form, over the real v2 store.

The v2 approvals come from the v2 runtime fixtures: `console_approval` is a CONSOLE
delivery to the run initiator's Contact (what an account's run hands its caller), and
`web_app_approval` is a WEB_APP delivery to an end user. The v1 lookup runs too, on the
same SQLite schema, and finds nothing for a v2 token. Body tests call `__handler__` with
a `Context` whose requirements already passed.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from constants.oauth_bearer import TokenType
from controllers.openapi._contract import op_of
from controllers.openapi._errors import HumanInputFormNotFound
from controllers.openapi._models import (
    FormSubmitResponse,
    Hint,
    HumanInputFormDefinitionResponse,
    OpenApiFormSubmitPayload,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, Subject
from controllers.openapi.human_input_form import (
    DRAFT_RUN_FORMS,
    PUBLISHED_RUN_FORMS,
    CheckFormSurface,
    FormVersion,
    OpenApiWorkflowHumanInputFormApi,
    OpenApiWorkflowHumanInputFormSubmitApi,
    with_form_hints,
)
from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi
from core.app.entities.task_entities import HumanInputRequiredResponse
from core.workflow.nodes.human_input import ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from extensions.ext_database import db
from libs.oauth_bearer import AuthContext
from models.account import Account
from models.enums import EndUserType
from models.human_input_v2 import HumanInputForm
from models.model import App, AppMode, EndUser
from services.human_input_service import FormSubmittedError
from services.human_input_v2.form_service import AccountInitiator
from tests.helpers.unit.services.human_input_v2_approvals import Context as V2Context

pytest_plugins = ("tests.helpers.unit.services.human_input_v2_approvals",)

_UNKNOWN_TOKEN = "no-such-form-token"
_OTHER_APP = "00000000-0000-0000-0000-0000000000ff"


@dataclass(frozen=True, slots=True)
class _Caller:
    subject: Subject
    user: Account | EndUser


def _auth(token_type: TokenType, *, account_id: str | None) -> AuthContext:
    return AuthContext(
        token_type=token_type,
        subject_email="sso@example.com",
        subject_issuer="https://idp.example.com",
        account_id=uuid.UUID(account_id) if account_id is not None else None,
        client_id="difyctl",
        token_id=uuid.uuid4(),
        expires_at=None,
    )


@pytest.fixture
def resumes(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    queued: list[dict[str, object]] = []

    def apply_async(*, kwargs: dict[str, object]) -> None:
        queued.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", apply_async)
    return queued


@pytest.fixture
def v1_store(context: V2Context, monkeypatch: pytest.MonkeyPatch) -> None:
    """The v1 lookup reads the same SQLite schema, where no v1 recipient holds a v2 token."""
    with context.sessions() as session:
        engine = session.get_bind()
    monkeypatch.setattr(type(db), "engine", property(lambda _: engine))


@pytest.fixture
def session(context: V2Context) -> Iterator[Session]:
    with context.sessions() as session:
        yield session


def _account(context: V2Context) -> _Caller:
    initiator = context.execution.initiator
    assert isinstance(initiator, AccountInitiator)
    account = Account(name="Initiator", email="member@example.com")
    account.id = initiator.account_id
    return _Caller(AccountSubject(_auth(TokenType.OAUTH_ACCOUNT, account_id=initiator.account_id)), account)


def _sso_end_user(context: V2Context, end_user_id: str) -> _Caller:
    end_user = EndUser(
        id=end_user_id,
        tenant_id=context.execution.tenant_id,
        app_id=context.execution.app_id,
        type=EndUserType.OPENAPI,
        session_id="sso@example.com",
    )
    return _Caller(ExternalSsoSubject(_auth(TokenType.OAUTH_EXTERNAL_SSO, account_id=None)), end_user)


def _ctx(
    context: V2Context, session: Session, caller: _Caller, *, form_token: str, app_id: str | None = None
) -> Context:
    route_app_id = app_id or context.execution.app_id
    ctx = Context(caller.subject, session, {"app_id": route_app_id, "form_token": form_token})
    ctx._app = App(
        id=route_app_id,
        tenant_id=context.execution.tenant_id,
        name="Approval app",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
    )
    ctx._caller = caller.user
    return ctx


def _describe(app: Flask, ctx: Context, form_token: str) -> dict[str, object]:
    api = OpenApiWorkflowHumanInputFormApi()
    with app.test_request_context(f"/openapi/v1/apps/{ctx.app.id}/human-input-forms/{form_token}"):
        response = api.get.__handler__(api, ctx, app_id=ctx.app.id, form_token=form_token)
    return json.loads(response.get_data(as_text=True))


def _submit(app: Flask, ctx: Context, form_token: str, *, action: str = "approve") -> FormSubmitResponse:
    api = OpenApiWorkflowHumanInputFormSubmitApi()
    with app.test_request_context(f"/openapi/v1/apps/{ctx.app.id}/human-input-forms/{form_token}:submit"):
        return api.post.__handler__(
            api,
            ctx,
            app_id=ctx.app.id,
            form_token=form_token,
            body=OpenApiFormSubmitPayload(action=action, inputs={"note": "Approved"}),
        )


def _status(context: V2Context, form_id: str) -> HumanInputFormStatus:
    with context.sessions() as session:
        return session.get_one(HumanInputForm, form_id).status


def _assert_v2_definition(payload: dict[str, object]) -> None:
    definition = HumanInputFormDefinitionResponse.model_validate(payload)
    assert definition.form_content == "Review: {{#$output.note#}}"
    assert [field["output_variable_name"] for field in definition.inputs] == ["note"]
    assert [action["id"] for action in definition.user_actions] == ["approve"]
    assert definition.resolved_default_values == {}
    assert isinstance(definition.expiration_time, int)


def _assert_follows_run(response: FormSubmitResponse, context: V2Context) -> None:
    [follow] = response.hints
    assert follow.op == op_of(OpenApiWorkflowEventsApi.get)
    assert follow.input == {
        "app_id": context.execution.app_id,
        "run_id": context.execution.workflow_run_id,
        "include_state_snapshot": True,
        "continue_on_pause": False,
    }


@pytest.mark.usefixtures("v1_store")
class TestAccountCaller:
    def test_describe_maps_the_v2_form_into_the_v1_response_shape(
        self, app: Flask, context: V2Context, session: Session, console_approval: tuple[str, str]
    ) -> None:
        _, token = console_approval
        _assert_v2_definition(_describe(app, _ctx(context, session, _account(context), form_token=token), token))

    def test_submit_accepts_the_form_resumes_the_run_and_hints_following_it(
        self,
        app: Flask,
        context: V2Context,
        session: Session,
        console_approval: tuple[str, str],
        resumes: list[dict[str, object]],
    ) -> None:
        form_id, token = console_approval
        response = _submit(app, _ctx(context, session, _account(context), form_token=token), token)

        assert _status(context, form_id) == HumanInputFormStatus.SUBMITTED
        assert resumes == [{"payload": {"workflow_run_id": context.execution.workflow_run_id}}]
        _assert_follows_run(response, context)

    @pytest.mark.usefixtures("resumes")
    def test_a_second_submit_answers_like_a_v1_form_already_submitted(
        self,
        app: Flask,
        context: V2Context,
        session: Session,
        console_approval: tuple[str, str],
    ) -> None:
        _, token = console_approval
        ctx = _ctx(context, session, _account(context), form_token=token)
        _submit(app, ctx, token)
        with pytest.raises(FormSubmittedError):
            _submit(app, ctx, token)

    def test_a_form_of_another_app_is_not_found_and_stays_waiting(
        self,
        app: Flask,
        context: V2Context,
        session: Session,
        console_approval: tuple[str, str],
        resumes: list[dict[str, object]],
    ) -> None:
        form_id, token = console_approval
        ctx = _ctx(context, session, _account(context), form_token=token, app_id=_OTHER_APP)
        with pytest.raises(HumanInputFormNotFound):
            _describe(app, ctx, token)
        with pytest.raises(HumanInputFormNotFound):
            _submit(app, ctx, token)
        assert _status(context, form_id) == HumanInputFormStatus.WAITING
        assert resumes == []


@pytest.mark.usefixtures("v1_store")
class TestSsoCaller:
    @pytest.mark.usefixtures("resumes")
    def test_describe_and_submit_as_the_form_s_end_user(
        self,
        app: Flask,
        context: V2Context,
        session: Session,
        web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    ) -> None:
        _, form_id, token, _, end_user_id = web_app_approval
        ctx = _ctx(context, session, _sso_end_user(context, end_user_id), form_token=token)

        _assert_v2_definition(_describe(app, ctx, token))
        response = _submit(app, ctx, token)

        assert _status(context, form_id) == HumanInputFormStatus.SUBMITTED
        _assert_follows_run(response, context)

    @pytest.mark.usefixtures("resumes")
    def test_another_end_user_does_not_find_the_form(
        self,
        app: Flask,
        context: V2Context,
        session: Session,
        web_app_approval: tuple[FlaskClient, str, str, dict[str, str], str],
    ) -> None:
        _, form_id, token, _, _ = web_app_approval
        ctx = _ctx(context, session, _sso_end_user(context, "someone-else"), form_token=token)
        with pytest.raises(HumanInputFormNotFound):
            _submit(app, ctx, token)
        assert _status(context, form_id) == HumanInputFormStatus.WAITING


@pytest.mark.usefixtures("v1_store")
@pytest.mark.parametrize("sso", [False, True], ids=["account", "sso"])
def test_an_unknown_token_is_a_clear_404(app: Flask, context: V2Context, session: Session, sso: bool) -> None:
    caller = _sso_end_user(context, "eu-unknown") if sso else _account(context)
    ctx = _ctx(context, session, caller, form_token=_UNKNOWN_TOKEN)
    with pytest.raises(HumanInputFormNotFound) as describe_error:
        _describe(app, ctx, _UNKNOWN_TOKEN)
    with pytest.raises(HumanInputFormNotFound):
        _submit(app, ctx, _UNKNOWN_TOKEN)
    assert describe_error.value.code == 404


def test_the_surface_check_leaves_a_v2_token_to_the_handler(
    context: V2Context, session: Session, console_approval: tuple[str, str]
) -> None:
    _, token = console_approval
    ctx = _ctx(context, session, _account(context), form_token=token)
    CheckFormSurface().run(ctx.subject, ctx, session)


def _paused(*, form_version: FormVersion, form_token: str | None) -> str:
    response = HumanInputRequiredResponse(
        task_id="t1",
        workflow_run_id="r1",
        data=HumanInputRequiredResponse.Data(
            form_version=form_version.value,
            form_id="f1",
            node_id="n1",
            node_title="Review",
            form_content="",
            inputs=[ParagraphInputConfig(output_variable_name="note")],
            actions=[UserActionConfig(id="approve", title="Approve")],
            form_token=form_token,
            expiration_time=4102444800,
        ),
    )
    return f"data: {json.dumps(response.model_dump(mode='json'))}\n\n"


def _hints(event: str, forms: frozenset[FormVersion], app_id: str) -> list[Hint]:
    [out] = list(with_form_hints(iter([event]), app_id=app_id, forms=forms))
    return [Hint.model_validate(hint) for hint in json.loads(out[len("data: ") :]).get("hints", [])]


class TestPauseHints:
    @pytest.mark.parametrize("form_version", list(FormVersion))
    def test_a_published_run_hints_submit_for_either_form_version(self, form_version: FormVersion) -> None:
        [hint] = _hints(_paused(form_version=form_version, form_token="ft-1"), PUBLISHED_RUN_FORMS, "a1")
        assert hint.op == op_of(OpenApiWorkflowHumanInputFormSubmitApi.post)

    def test_a_draft_run_hints_submit_for_a_v2_form_only(self) -> None:
        assert _hints(_paused(form_version=FormVersion.V2, form_token="ft-1"), DRAFT_RUN_FORMS, "a1") != []
        assert _hints(_paused(form_version=FormVersion.V1, form_token="ft-1"), DRAFT_RUN_FORMS, "a1") == []

    @pytest.mark.usefixtures("v1_store")
    @pytest.mark.usefixtures("resumes")
    def test_a_v2_pause_hint_resolves_against_the_submit_op(
        self,
        app: Flask,
        context: V2Context,
        session: Session,
        console_approval: tuple[str, str],
    ) -> None:
        form_id, token = console_approval
        app_id = context.execution.app_id
        [hint] = _hints(_paused(form_version=FormVersion.V2, form_token=token), DRAFT_RUN_FORMS, app_id)
        assert hint.input["form_token"] == token

        ctx = _ctx(context, session, _account(context), form_token=token)
        api = OpenApiWorkflowHumanInputFormSubmitApi()
        with app.test_request_context(f"/openapi/v1/apps/{app_id}/human-input-forms/{token}:submit"):
            api.post.__handler__(
                api,
                ctx,
                app_id=app_id,
                form_token=token,
                body=OpenApiFormSubmitPayload(action=hint.input["action"], inputs={"note": "ok"}),
            )
        assert _status(context, form_id) == HumanInputFormStatus.SUBMITTED
