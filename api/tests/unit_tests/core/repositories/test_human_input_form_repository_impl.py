"""Unit tests for HumanInputFormRepositoryImpl private helpers."""

from __future__ import annotations

import dataclasses
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.repositories.human_input_reposotiry import (
    HumanInputFormRecord,
    HumanInputFormRepositoryImpl,
    HumanInputFormSubmissionRepository,
    _WorkspaceMemberInfo,
)
from core.workflow.nodes.human_input.entities import (
    ExternalRecipient,
    FormDefinition,
    MemberRecipient,
    TimeoutUnit,
    UserAction,
)
from core.workflow.repositories.human_input_form_repository import FormNotFoundError
from libs.datetime_utils import naive_utc_now
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputFormRecipient,
    RecipientType,
)


def _build_repository() -> HumanInputFormRepositoryImpl:
    return HumanInputFormRepositoryImpl(session_factory=MagicMock(), tenant_id="tenant-id")


def _patch_recipient_factory(monkeypatch: pytest.MonkeyPatch) -> list[SimpleNamespace]:
    created: list[SimpleNamespace] = []

    def fake_new(cls, form_id: str, delivery_id: str, payload):  # type: ignore[no-untyped-def]
        recipient = SimpleNamespace(
            form_id=form_id,
            delivery_id=delivery_id,
            recipient_type=payload.TYPE,
            recipient_payload=payload.model_dump_json(),
        )
        created.append(recipient)
        return recipient

    monkeypatch.setattr(HumanInputFormRecipient, "new", classmethod(fake_new))
    return created


@pytest.fixture(autouse=True)
def _stub_selectinload(monkeypatch: pytest.MonkeyPatch) -> None:
    """Avoid SQLAlchemy mapper configuration in tests using fake sessions."""

    class _FakeSelect:
        def options(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
            return self

        def where(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
            return self

    monkeypatch.setattr(
        "core.repositories.human_input_reposotiry.selectinload", lambda *args, **kwargs: "_loader_option"
    )
    monkeypatch.setattr("core.repositories.human_input_reposotiry.select", lambda *args, **kwargs: _FakeSelect())


class TestHumanInputFormRepositoryImplHelpers:
    def test_create_email_recipients_with_member_and_external(self, monkeypatch: pytest.MonkeyPatch) -> None:
        repo = _build_repository()
        session_stub = object()
        _patch_recipient_factory(monkeypatch)

        def fake_query(self, session, user_ids):  # type: ignore[no-untyped-def]
            assert session is session_stub
            assert user_ids == ["member-1"]
            return [_WorkspaceMemberInfo(user_id="member-1", email="member@example.com")]

        monkeypatch.setattr(HumanInputFormRepositoryImpl, "_query_workspace_members", fake_query)

        recipients = repo._create_email_recipients(
            session=session_stub,
            form_id="form-id",
            delivery_id="delivery-id",
            recipients=[
                MemberRecipient(user_id="member-1"),
                ExternalRecipient(email="external@example.com"),
            ],
        )

        assert len(recipients) == 2
        member_recipient = next(r for r in recipients if r.recipient_type == RecipientType.EMAIL_MEMBER)
        external_recipient = next(r for r in recipients if r.recipient_type == RecipientType.EMAIL_EXTERNAL)

        member_payload = EmailMemberRecipientPayload.model_validate_json(member_recipient.recipient_payload)
        assert member_payload.user_id == "member-1"
        assert member_payload.email == "member@example.com"

        external_payload = EmailExternalRecipientPayload.model_validate_json(external_recipient.recipient_payload)
        assert external_payload.email == "external@example.com"

    def test_create_email_recipients_skips_unknown_members(self, monkeypatch: pytest.MonkeyPatch) -> None:
        repo = _build_repository()
        session_stub = object()
        created = _patch_recipient_factory(monkeypatch)

        def fake_query(self, session, user_ids):  # type: ignore[no-untyped-def]
            assert session is session_stub
            assert user_ids == ["missing-member"]
            return []

        monkeypatch.setattr(HumanInputFormRepositoryImpl, "_query_workspace_members", fake_query)

        recipients = repo._create_email_recipients(
            session=session_stub,
            form_id="form-id",
            delivery_id="delivery-id",
            recipients=[
                MemberRecipient(user_id="missing-member"),
                ExternalRecipient(email="external@example.com"),
            ],
        )

        assert len(recipients) == 1
        assert recipients[0].recipient_type == RecipientType.EMAIL_EXTERNAL
        assert len(created) == 1  # only external recipient created via factory

    def test_create_whole_workspace_recipients_uses_all_members(self, monkeypatch: pytest.MonkeyPatch) -> None:
        repo = _build_repository()
        session_stub = object()
        _patch_recipient_factory(monkeypatch)

        def fake_query(self, session, user_ids):  # type: ignore[no-untyped-def]
            assert session is session_stub
            assert user_ids is None
            return [
                _WorkspaceMemberInfo(user_id="member-1", email="member1@example.com"),
                _WorkspaceMemberInfo(user_id="member-2", email="member2@example.com"),
            ]

        monkeypatch.setattr(HumanInputFormRepositoryImpl, "_query_workspace_members", fake_query)

        recipients = repo._create_whole_workspace_recipients(
            session=session_stub,
            form_id="form-id",
            delivery_id="delivery-id",
        )

        assert len(recipients) == 2
        emails = {EmailMemberRecipientPayload.model_validate_json(r.recipient_payload).email for r in recipients}
        assert emails == {"member1@example.com", "member2@example.com"}


def _make_form_definition() -> str:
    return FormDefinition(
        form_content="hello",
        inputs=[],
        user_actions=[UserAction(id="submit", title="Submit")],
        rendered_content="<p>hello</p>",
        timeout=1,
        timeout_unit=TimeoutUnit.HOUR,
    ).model_dump_json()


@dataclasses.dataclass
class _DummyForm:
    id: str
    workflow_run_id: str
    node_id: str
    tenant_id: str
    form_definition: str
    rendered_content: str
    expiration_time: datetime
    selected_action_id: str | None = None
    submitted_data: str | None = None
    submitted_at: datetime | None = None
    submission_user_id: str | None = None
    submission_end_user_id: str | None = None
    completed_by_recipient_id: str | None = None


@dataclasses.dataclass
class _DummyRecipient:
    id: str
    form_id: str
    recipient_type: RecipientType
    access_token: str
    form: _DummyForm | None = None


class _FakeScalarResult:
    def __init__(self, obj):
        self._obj = obj

    def first(self):
        if isinstance(self._obj, list):
            return self._obj[0] if self._obj else None
        return self._obj

    def all(self):
        if isinstance(self._obj, list):
            return list(self._obj)
        if self._obj is None:
            return []
        return [self._obj]


class _FakeSession:
    def __init__(
        self,
        *,
        scalars_result=None,
        scalars_results: list[object] | None = None,
        forms: dict[str, _DummyForm] | None = None,
        recipients: dict[str, _DummyRecipient] | None = None,
    ):
        if scalars_results is not None:
            self._scalars_queue = list(scalars_results)
        elif scalars_result is not None:
            self._scalars_queue = [scalars_result]
        else:
            self._scalars_queue = []
        self.forms = forms or {}
        self.recipients = recipients or {}

    def scalars(self, _query):
        if self._scalars_queue:
            result = self._scalars_queue.pop(0)
        else:
            result = None
        return _FakeScalarResult(result)

    def get(self, model_cls, obj_id):  # type: ignore[no-untyped-def]
        if getattr(model_cls, "__name__", None) == "HumanInputForm":
            return self.forms.get(obj_id)
        if getattr(model_cls, "__name__", None) == "HumanInputFormRecipient":
            return self.recipients.get(obj_id)
        return None

    def add(self, _obj):
        return None

    def flush(self):
        return None

    def refresh(self, _obj):
        return None

    def begin(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None


def _session_factory(session: _FakeSession):
    class _SessionContext:
        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return None

    def _factory(*_args, **_kwargs):
        return _SessionContext()

    return _factory


class TestHumanInputFormRepositoryImplPublicMethods:
    def test_get_form_returns_entity_and_recipients(self):
        form = _DummyForm(
            id="form-1",
            workflow_run_id="run-1",
            node_id="node-1",
            tenant_id="tenant-id",
            form_definition=_make_form_definition(),
            rendered_content="<p>hello</p>",
            expiration_time=naive_utc_now(),
        )
        recipient = _DummyRecipient(
            id="recipient-1",
            form_id=form.id,
            recipient_type=RecipientType.WEBAPP,
            access_token="token-123",
        )
        session = _FakeSession(scalars_results=[form, [recipient]])
        repo = HumanInputFormRepositoryImpl(_session_factory(session), tenant_id="tenant-id")

        entity = repo.get_form(form.workflow_run_id, form.node_id)

        assert entity is not None
        assert entity.id == form.id
        assert entity.web_app_token == "token-123"
        assert len(entity.recipients) == 1
        assert entity.recipients[0].token == "token-123"

    def test_get_form_returns_none_when_missing(self):
        session = _FakeSession(scalars_results=[None])
        repo = HumanInputFormRepositoryImpl(_session_factory(session), tenant_id="tenant-id")

        assert repo.get_form("run-1", "node-1") is None

    def test_get_form_submission_returns_none_when_pending(self):
        form = _DummyForm(
            id="form-1",
            workflow_run_id="run-1",
            node_id="node-1",
            tenant_id="tenant-id",
            form_definition=_make_form_definition(),
            rendered_content="<p>hello</p>",
            expiration_time=naive_utc_now(),
        )
        session = _FakeSession(forms={form.id: form})
        repo = HumanInputFormRepositoryImpl(_session_factory(session), tenant_id="tenant-id")

        assert repo.get_form_submission(form.id) is None

    def test_get_form_submission_returns_submission_when_completed(self):
        form = _DummyForm(
            id="form-1",
            workflow_run_id="run-1",
            node_id="node-1",
            tenant_id="tenant-id",
            form_definition=_make_form_definition(),
            rendered_content="<p>hello</p>",
            expiration_time=naive_utc_now(),
            selected_action_id="approve",
            submitted_data='{"field": "value"}',
            submitted_at=naive_utc_now(),
        )
        session = _FakeSession(forms={form.id: form})
        repo = HumanInputFormRepositoryImpl(_session_factory(session), tenant_id="tenant-id")

        submission = repo.get_form_submission(form.id)

        assert submission is not None
        assert submission.selected_action_id == "approve"
        assert submission.form_data() == {"field": "value"}

    def test_get_form_submission_raises_when_form_missing(self):
        session = _FakeSession(forms={})
        repo = HumanInputFormRepositoryImpl(_session_factory(session), tenant_id="tenant-id")

        with pytest.raises(FormNotFoundError):
            repo.get_form_submission("form-unknown")


class TestHumanInputFormSubmissionRepository:
    def test_get_by_token_returns_record(self):
        form = _DummyForm(
            id="form-1",
            workflow_run_id="run-1",
            node_id="node-1",
            tenant_id="tenant-1",
            form_definition=_make_form_definition(),
            rendered_content="<p>hello</p>",
            expiration_time=naive_utc_now(),
        )
        recipient = _DummyRecipient(
            id="recipient-1",
            form_id=form.id,
            recipient_type=RecipientType.WEBAPP,
            access_token="token-123",
            form=form,
        )
        session = _FakeSession(scalars_result=recipient)
        repo = HumanInputFormSubmissionRepository(_session_factory(session))

        record = repo.get_by_token("token-123")

        assert record is not None
        assert record.form_id == form.id
        assert record.recipient_type == RecipientType.WEBAPP
        assert record.submitted is False

    def test_get_by_form_id_and_recipient_type_uses_recipient(self):
        form = _DummyForm(
            id="form-1",
            workflow_run_id="run-1",
            node_id="node-1",
            tenant_id="tenant-1",
            form_definition=_make_form_definition(),
            rendered_content="<p>hello</p>",
            expiration_time=naive_utc_now(),
        )
        recipient = _DummyRecipient(
            id="recipient-1",
            form_id=form.id,
            recipient_type=RecipientType.WEBAPP,
            access_token="token-123",
            form=form,
        )
        session = _FakeSession(scalars_result=recipient)
        repo = HumanInputFormSubmissionRepository(_session_factory(session))

        record = repo.get_by_form_id_and_recipient_type(form_id=form.id, recipient_type=RecipientType.WEBAPP)

        assert record is not None
        assert record.recipient_id == recipient.id
        assert record.access_token == recipient.access_token

    def test_mark_submitted_updates_fields(self, monkeypatch: pytest.MonkeyPatch):
        fixed_now = datetime(2024, 1, 1, 0, 0, 0)
        monkeypatch.setattr("core.repositories.human_input_reposotiry.naive_utc_now", lambda: fixed_now)

        form = _DummyForm(
            id="form-1",
            workflow_run_id="run-1",
            node_id="node-1",
            tenant_id="tenant-1",
            form_definition=_make_form_definition(),
            rendered_content="<p>hello</p>",
            expiration_time=fixed_now,
        )
        recipient = _DummyRecipient(
            id="recipient-1",
            form_id="form-1",
            recipient_type=RecipientType.WEBAPP,
            access_token="token-123",
        )
        session = _FakeSession(
            forms={form.id: form},
            recipients={recipient.id: recipient},
        )
        repo = HumanInputFormSubmissionRepository(_session_factory(session))

        record: HumanInputFormRecord = repo.mark_submitted(
            form_id=form.id,
            recipient_id=recipient.id,
            selected_action_id="approve",
            form_data={"field": "value"},
            submission_user_id="user-1",
            submission_end_user_id="end-user-1",
        )

        assert form.selected_action_id == "approve"
        assert form.completed_by_recipient_id == recipient.id
        assert form.submission_user_id == "user-1"
        assert form.submission_end_user_id == "end-user-1"
        assert form.submitted_at == fixed_now
        assert record.submitted is True
        assert record.selected_action_id == "approve"
        assert record.submitted_data == {"field": "value"}
