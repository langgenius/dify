from __future__ import annotations

import dataclasses
import json
from collections.abc import Sequence
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from graphon.nodes.human_input.entities import HumanInputNodeData, UserAction
from graphon.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus

from core.repositories.human_input_repository import (
    FormCreateParams,
    FormNotFoundError,
    HumanInputFormRecord,
    HumanInputFormRepositoryImpl,
    HumanInputFormSubmissionRepository,
    _HumanInputFormEntityImpl,
    _HumanInputFormRecipientEntityImpl,
    _InvalidTimeoutStatusError,
    _WorkspaceMemberInfo,
)
from core.workflow.human_input_compat import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    MemberRecipient,
    WebAppDeliveryMethod,
)
from libs.datetime_utils import naive_utc_now
from models.human_input import HumanInputFormRecipient, RecipientType


@pytest.fixture(autouse=True)
def _stub_select(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeSelect:
        def join(self, *_args: Any, **_kwargs: Any) -> _FakeSelect:
            return self

        def where(self, *_args: Any, **_kwargs: Any) -> _FakeSelect:
            return self

        def options(self, *_args: Any, **_kwargs: Any) -> _FakeSelect:
            return self

    monkeypatch.setattr("core.repositories.human_input_repository.select", lambda *_args, **_kwargs: _FakeSelect())
    monkeypatch.setattr("core.repositories.human_input_repository.selectinload", lambda *_args, **_kwargs: "_loader")


def _make_form_definition_json(*, include_expiration_time: bool) -> str:
    payload: dict[str, Any] = {
        "form_content": "hi",
        "inputs": [],
        "user_actions": [{"id": "submit", "title": "Submit"}],
        "rendered_content": "<p>hi</p>",
    }
    if include_expiration_time:
        payload["expiration_time"] = naive_utc_now()
    return json.dumps(payload, default=str)


@dataclasses.dataclass
class _DummyForm:
    id: str
    workflow_run_id: str | None
    node_id: str
    tenant_id: str
    app_id: str
    form_definition: str
    rendered_content: str
    expiration_time: datetime
    form_kind: HumanInputFormKind = HumanInputFormKind.RUNTIME
    created_at: datetime = dataclasses.field(default_factory=naive_utc_now)
    selected_action_id: str | None = None
    submitted_data: str | None = None
    submitted_at: datetime | None = None
    submission_user_id: str | None = None
    submission_end_user_id: str | None = None
    completed_by_recipient_id: str | None = None
    status: HumanInputFormStatus = HumanInputFormStatus.WAITING


@dataclasses.dataclass
class _DummyRecipient:
    id: str
    form_id: str
    recipient_type: RecipientType
    access_token: str | None


class _FakeScalarResult:
    def __init__(self, obj: Any):
        self._obj = obj

    def first(self) -> Any:
        if isinstance(self._obj, list):
            return self._obj[0] if self._obj else None
        return self._obj

    def all(self) -> list[Any]:
        if self._obj is None:
            return []
        if isinstance(self._obj, list):
            return list(self._obj)
        return [self._obj]


class _FakeExecuteResult:
    def __init__(self, rows: Sequence[tuple[Any, ...]]):
        self._rows = list(rows)

    def all(self) -> list[tuple[Any, ...]]:
        return list(self._rows)


class _FakeSession:
    def __init__(
        self,
        *,
        scalars_result: Any = None,
        scalars_results: list[Any] | None = None,
        forms: dict[str, _DummyForm] | None = None,
        recipients: dict[str, _DummyRecipient] | None = None,
        execute_rows: Sequence[tuple[Any, ...]] = (),
    ):
        if scalars_results is not None:
            self._scalars_queue = list(scalars_results)
        else:
            self._scalars_queue = [scalars_result]
        self._forms = forms or {}
        self._recipients = recipients or {}
        self._execute_rows = list(execute_rows)
        self.added: list[Any] = []

    def scalars(self, _query: Any) -> _FakeScalarResult:
        if self._scalars_queue:
            value = self._scalars_queue.pop(0)
        else:
            value = None
        return _FakeScalarResult(value)

    def execute(self, _stmt: Any) -> _FakeExecuteResult:
        return _FakeExecuteResult(self._execute_rows)

    def get(self, model_cls: Any, obj_id: str) -> Any:
        name = getattr(model_cls, "__name__", "")
        if name == "HumanInputForm":
            return self._forms.get(obj_id)
        if name == "HumanInputFormRecipient":
            return self._recipients.get(obj_id)
        return None

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def add_all(self, objs: Sequence[Any]) -> None:
        self.added.extend(list(objs))

    def flush(self) -> None:
        # Simulate DB default population for attributes referenced in entity wrappers.
        for obj in self.added:
            if hasattr(obj, "id") and obj.id in (None, ""):
                obj.id = f"gen-{len(str(self.added))}"
            if isinstance(obj, HumanInputFormRecipient) and obj.access_token is None:
                if obj.recipient_type == RecipientType.CONSOLE:
                    obj.access_token = "token-console"
                elif obj.recipient_type == RecipientType.BACKSTAGE:
                    obj.access_token = "token-backstage"
                else:
                    obj.access_token = "token-webapp"

    def refresh(self, _obj: Any) -> None:
        return None

    def begin(self) -> _FakeSession:
        return self

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class _SessionFactoryStub:
    def __init__(self, session: _FakeSession):
        self._session = session

    def create_session(self) -> _FakeSession:
        return self._session


def _patch_session_factory(monkeypatch: pytest.MonkeyPatch, session: _FakeSession) -> None:
    monkeypatch.setattr("core.repositories.human_input_repository.session_factory", _SessionFactoryStub(session))


def test_recipient_entity_token_raises_when_missing() -> None:
    recipient = SimpleNamespace(id="r1", access_token=None)
    entity = _HumanInputFormRecipientEntityImpl(recipient)  # type: ignore[arg-type]
    with pytest.raises(AssertionError, match="access_token should not be None"):
        _ = entity.token


def test_recipient_entity_id_and_token_success() -> None:
    recipient = SimpleNamespace(id="r1", access_token="tok")
    entity = _HumanInputFormRecipientEntityImpl(recipient)  # type: ignore[arg-type]
    assert entity.id == "r1"
    assert entity.token == "tok"


def test_form_entity_submission_token_prefers_console_then_webapp_then_none() -> None:
    form = _DummyForm(
        id="f1",
        workflow_run_id="run",
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
    )
    console = _DummyRecipient(id="c1", form_id=form.id, recipient_type=RecipientType.CONSOLE, access_token="ctok")
    webapp = _DummyRecipient(
        id="w1", form_id=form.id, recipient_type=RecipientType.STANDALONE_WEB_APP, access_token="wtok"
    )

    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[webapp, console])  # type: ignore[arg-type]
    assert entity.submission_token == "ctok"

    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[webapp])  # type: ignore[arg-type]
    assert entity.submission_token == "wtok"

    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[])  # type: ignore[arg-type]
    assert entity.submission_token is None


def test_form_entity_submitted_data_parsed() -> None:
    form = _DummyForm(
        id="f1",
        workflow_run_id="run",
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
        submitted_data='{"a": 1}',
        submitted_at=naive_utc_now(),
    )
    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[])  # type: ignore[arg-type]
    assert entity.submitted is True
    assert entity.submitted_data == {"a": 1}
    assert entity.rendered_content == "<p>x</p>"
    assert entity.selected_action_id is None
    assert entity.status == HumanInputFormStatus.WAITING


def test_form_record_from_models_injects_expiration_time_when_missing() -> None:
    expiration = naive_utc_now()
    form = _DummyForm(
        id="f1",
        workflow_run_id=None,
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=False),
        rendered_content="<p>x</p>",
        expiration_time=expiration,
        submitted_data='{"k": "v"}',
    )
    record = HumanInputFormRecord.from_models(form, None)  # type: ignore[arg-type]
    assert record.definition.expiration_time == expiration
    assert record.submitted_data == {"k": "v"}
    assert record.submitted is False


def test_create_email_recipients_from_resolved_dedupes_and_skips_blank(monkeypatch: pytest.MonkeyPatch) -> None:
    created: list[SimpleNamespace] = []

    def fake_new(cls, form_id: str, delivery_id: str, payload: Any):  # type: ignore[no-untyped-def]
        recipient = SimpleNamespace(
            id=f"{payload.TYPE}-{len(created)}",
            form_id=form_id,
            delivery_id=delivery_id,
            recipient_type=payload.TYPE,
            recipient_payload=payload.model_dump_json(),
            access_token="tok",
        )
        created.append(recipient)
        return recipient

    monkeypatch.setattr("core.repositories.human_input_repository.HumanInputFormRecipient.new", classmethod(fake_new))

    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    recipients = repo._create_email_recipients_from_resolved(  # type: ignore[attr-defined]
        form_id="f",
        delivery_id="d",
        members=[
            _WorkspaceMemberInfo(user_id="u1", email=""),
            _WorkspaceMemberInfo(user_id="u2", email="a@example.com"),
            _WorkspaceMemberInfo(user_id="u3", email="a@example.com"),
        ],
        external_emails=["", "a@example.com", "b@example.com", "b@example.com"],
    )
    assert [r.recipient_type for r in recipients] == [RecipientType.EMAIL_MEMBER, RecipientType.EMAIL_EXTERNAL]


def test_query_workspace_members_by_ids_empty_returns_empty() -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    assert repo._query_workspace_members_by_ids(session=MagicMock(), restrict_to_user_ids=["", ""]) == []


def test_query_workspace_members_by_ids_maps_rows() -> None:
    session = _FakeSession(execute_rows=[("u1", "a@example.com"), ("u2", "b@example.com")])
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    rows = repo._query_workspace_members_by_ids(session=session, restrict_to_user_ids=["u1", "u2"])
    assert rows == [
        _WorkspaceMemberInfo(user_id="u1", email="a@example.com"),
        _WorkspaceMemberInfo(user_id="u2", email="b@example.com"),
    ]


def test_query_all_workspace_members_maps_rows() -> None:
    session = _FakeSession(execute_rows=[("u1", "a@example.com")])
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    rows = repo._query_all_workspace_members(session=session)
    assert rows == [_WorkspaceMemberInfo(user_id="u1", email="a@example.com")]


def test_repository_init_sets_tenant_id() -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    assert repo._tenant_id == "tenant"


def test_delivery_method_to_model_webapp_creates_delivery_and_recipient(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    monkeypatch.setattr("core.repositories.human_input_repository.uuidv7", lambda: "del-1")
    result = repo._delivery_method_to_model(
        session=MagicMock(), form_id="form-1", delivery_method=WebAppDeliveryMethod()
    )
    assert result.delivery.id == "del-1"
    assert result.delivery.form_id == "form-1"
    assert len(result.recipients) == 1
    assert result.recipients[0].recipient_type == RecipientType.STANDALONE_WEB_APP


def test_delivery_method_to_model_email_uses_build_email_recipients(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    monkeypatch.setattr("core.repositories.human_input_repository.uuidv7", lambda: "del-1")
    called: dict[str, Any] = {}

    def fake_build(*, session: Any, form_id: str, delivery_id: str, recipients_config: Any) -> list[Any]:
        called.update(
            {"session": session, "form_id": form_id, "delivery_id": delivery_id, "recipients_config": recipients_config}
        )
        return ["r"]

    monkeypatch.setattr(repo, "_build_email_recipients", fake_build)

    method = EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(
                include_bound_group=False,
                items=[MemberRecipient(reference_id="u1"), ExternalRecipient(email="e@example.com")],
            ),
            subject="s",
            body="b",
        )
    )
    result = repo._delivery_method_to_model(session="sess", form_id="form-1", delivery_method=method)
    assert result.recipients == ["r"]
    assert called["delivery_id"] == "del-1"


def test_build_email_recipients_uses_all_members_when_whole_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    monkeypatch.setattr(
        repo,
        "_query_all_workspace_members",
        lambda *, session: [_WorkspaceMemberInfo(user_id="u", email="a@example.com")],
    )
    monkeypatch.setattr(repo, "_create_email_recipients_from_resolved", lambda **_: ["ok"])
    recipients = repo._build_email_recipients(
        session=MagicMock(),
        form_id="f",
        delivery_id="d",
        recipients_config=EmailRecipients(include_bound_group=True, items=[ExternalRecipient(email="e@example.com")]),
    )
    assert recipients == ["ok"]


def test_build_email_recipients_uses_selected_members_when_not_whole_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")

    def fake_query(*, session: Any, restrict_to_user_ids: Sequence[str]) -> list[_WorkspaceMemberInfo]:
        assert restrict_to_user_ids == ["u1"]
        return [_WorkspaceMemberInfo(user_id="u1", email="a@example.com")]

    monkeypatch.setattr(repo, "_query_workspace_members_by_ids", fake_query)
    monkeypatch.setattr(repo, "_create_email_recipients_from_resolved", lambda **_: ["ok"])
    recipients = repo._build_email_recipients(
        session=MagicMock(),
        form_id="f",
        delivery_id="d",
        recipients_config=EmailRecipients(
            include_bound_group=False,
            items=[MemberRecipient(reference_id="u1"), ExternalRecipient(email="e@example.com")],
        ),
    )
    assert recipients == ["ok"]


def test_get_form_returns_entity_and_none_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_session_factory(monkeypatch, _FakeSession(scalars_results=[None]))
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant", workflow_execution_id="run")
    assert repo.get_form("node") is None

    form = _DummyForm(
        id="f1",
        workflow_run_id="run",
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
    )
    recipient = _DummyRecipient(
        id="r1",
        form_id=form.id,
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        access_token="tok",
    )
    session = _FakeSession(scalars_results=[form, [recipient]])
    _patch_session_factory(monkeypatch, session)
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant", workflow_execution_id="run")
    entity = repo.get_form("node")
    assert entity is not None
    assert entity.id == "f1"
    assert entity.recipients[0].id == "r1"
    assert entity.recipients[0].token == "tok"


def test_create_form_adds_console_and_backstage_recipients(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = datetime(2024, 1, 1, 0, 0, 0)
    monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

    ids = iter(["form-id", "del-web", "del-console", "del-backstage"])
    monkeypatch.setattr("core.repositories.human_input_repository.uuidv7", lambda: next(ids))

    session = _FakeSession()
    _patch_session_factory(monkeypatch, session)
    repo = HumanInputFormRepositoryImpl(
        tenant_id="tenant",
        app_id="app",
        workflow_execution_id="run",
        invoke_source="debugger",
        submission_actor_id="acc-1",
    )

    form_config = HumanInputNodeData(
        title="Title",
        delivery_methods=[],
        form_content="hello",
        inputs=[],
        user_actions=[UserAction(id="submit", title="Submit")],
    )
    params = FormCreateParams(
        workflow_execution_id=None,
        node_id="node",
        form_config=form_config,
        rendered_content="<p>hello</p>",
        delivery_methods=[WebAppDeliveryMethod()],
        display_in_ui=True,
        resolved_default_values={},
        form_kind=HumanInputFormKind.RUNTIME,
    )

    entity = repo.create_form(params)
    assert entity.id == "form-id"
    assert entity.expiration_time == fixed_now + timedelta(hours=form_config.timeout)
    # Console token should take precedence when console recipient is present.
    assert entity.submission_token == "token-console"
    assert len(entity.recipients) == 3


def test_submission_get_by_token_returns_none_when_missing_or_form_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_session_factory(monkeypatch, _FakeSession(scalars_result=None))
    repo = HumanInputFormSubmissionRepository()
    assert repo.get_by_token("tok") is None

    recipient = SimpleNamespace(form=None)
    _patch_session_factory(monkeypatch, _FakeSession(scalars_result=recipient))
    repo = HumanInputFormSubmissionRepository()
    assert repo.get_by_token("tok") is None


def test_submission_repository_init_no_args() -> None:
    repo = HumanInputFormSubmissionRepository()
    assert isinstance(repo, HumanInputFormSubmissionRepository)


def test_submission_get_by_token_and_get_by_form_id_success_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    form = _DummyForm(
        id="f1",
        workflow_run_id=None,
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
    )
    recipient = SimpleNamespace(
        id="r1",
        form_id=form.id,
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        access_token="tok",
        form=form,
    )

    _patch_session_factory(monkeypatch, _FakeSession(scalars_result=recipient))
    repo = HumanInputFormSubmissionRepository()
    record = repo.get_by_token("tok")
    assert record is not None
    assert record.access_token == "tok"

    _patch_session_factory(monkeypatch, _FakeSession(scalars_result=recipient))
    repo = HumanInputFormSubmissionRepository()
    record = repo.get_by_form_id_and_recipient_type(form_id=form.id, recipient_type=RecipientType.STANDALONE_WEB_APP)
    assert record is not None
    assert record.recipient_id == "r1"


def test_submission_get_by_form_id_returns_none_on_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_session_factory(monkeypatch, _FakeSession(scalars_result=None))
    repo = HumanInputFormSubmissionRepository()
    assert repo.get_by_form_id_and_recipient_type(form_id="f", recipient_type=RecipientType.CONSOLE) is None


def test_mark_submitted_updates_and_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = datetime(2024, 1, 1, 0, 0, 0)
    monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

    missing_session = _FakeSession(forms={})
    _patch_session_factory(monkeypatch, missing_session)
    repo = HumanInputFormSubmissionRepository()
    with pytest.raises(FormNotFoundError, match="form not found"):
        repo.mark_submitted(
            form_id="missing",
            recipient_id=None,
            selected_action_id="a",
            form_data={},
            submission_user_id=None,
            submission_end_user_id=None,
        )

    form = _DummyForm(
        id="f",
        workflow_run_id=None,
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=fixed_now,
    )
    recipient = _DummyRecipient(id="r", form_id=form.id, recipient_type=RecipientType.CONSOLE, access_token="tok")
    session = _FakeSession(forms={form.id: form}, recipients={recipient.id: recipient})
    _patch_session_factory(monkeypatch, session)
    repo = HumanInputFormSubmissionRepository()
    record = repo.mark_submitted(
        form_id=form.id,
        recipient_id=recipient.id,
        selected_action_id="approve",
        form_data={"k": "v"},
        submission_user_id="u",
        submission_end_user_id="eu",
    )
    assert form.status == HumanInputFormStatus.SUBMITTED
    assert form.submitted_at == fixed_now
    assert record.submitted_data == {"k": "v"}


def test_mark_timeout_invalid_status_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    form = _DummyForm(
        id="f",
        workflow_run_id=None,
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
    )
    session = _FakeSession(forms={form.id: form})
    _patch_session_factory(monkeypatch, session)
    repo = HumanInputFormSubmissionRepository()
    with pytest.raises(_InvalidTimeoutStatusError, match="invalid timeout status"):
        repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.SUBMITTED)  # type: ignore[arg-type]


def test_mark_timeout_already_timed_out_returns_record(monkeypatch: pytest.MonkeyPatch) -> None:
    form = _DummyForm(
        id="f",
        workflow_run_id=None,
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
        status=HumanInputFormStatus.TIMEOUT,
    )
    session = _FakeSession(forms={form.id: form})
    _patch_session_factory(monkeypatch, session)
    repo = HumanInputFormSubmissionRepository()
    record = repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.TIMEOUT, reason="r")
    assert record.status == HumanInputFormStatus.TIMEOUT


def test_mark_timeout_submitted_raises_form_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    form = _DummyForm(
        id="f",
        workflow_run_id=None,
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
        status=HumanInputFormStatus.SUBMITTED,
    )
    session = _FakeSession(forms={form.id: form})
    _patch_session_factory(monkeypatch, session)
    repo = HumanInputFormSubmissionRepository()
    with pytest.raises(FormNotFoundError, match="form already submitted"):
        repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.EXPIRED)


def test_mark_timeout_updates_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    form = _DummyForm(
        id="f",
        workflow_run_id=None,
        node_id="node",
        tenant_id="tenant",
        app_id="app",
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now(),
        selected_action_id="a",
        submitted_data="{}",
        submission_user_id="u",
        submission_end_user_id="eu",
        completed_by_recipient_id="r",
        status=HumanInputFormStatus.WAITING,
    )
    session = _FakeSession(forms={form.id: form})
    _patch_session_factory(monkeypatch, session)
    repo = HumanInputFormSubmissionRepository()
    record = repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.EXPIRED)
    assert form.status == HumanInputFormStatus.EXPIRED
    assert form.selected_action_id is None
    assert form.submitted_data is None
    assert form.submission_user_id is None
    assert form.submission_end_user_id is None
    assert form.completed_by_recipient_id is None
    assert record.status == HumanInputFormStatus.EXPIRED


def test_mark_timeout_raises_when_form_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_session_factory(monkeypatch, _FakeSession(forms={}))
    repo = HumanInputFormSubmissionRepository()
    with pytest.raises(FormNotFoundError, match="form not found"):
        repo.mark_timeout(form_id="missing", timeout_status=HumanInputFormStatus.TIMEOUT)
