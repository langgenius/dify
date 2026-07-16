from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from datetime import datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

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
from core.workflow.human_input_adapter import (
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    MemberRecipient,
    WebAppDeliveryMethod,
)
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from libs.datetime_utils import naive_utc_now
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase
from models.human_input import (
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
)


@pytest.fixture
def repository_session(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Bind repository-owned sessions to an isolated SQLite database."""

    tables = [
        HumanInputForm.__table__,
        HumanInputDelivery.__table__,
        HumanInputFormRecipient.__table__,
        Account.__table__,
        TenantAccountJoin.__table__,
    ]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    repository_session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(
        "core.repositories.human_input_repository.session_factory.create_session",
        repository_session_factory,
    )
    with repository_session_factory() as session:
        yield session


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


def _persist_form(
    session: Session,
    *,
    form_id: str = "form-1",
    tenant_id: str = "tenant",
    workflow_run_id: str | None = "run",
    node_id: str = "node",
    status: HumanInputFormStatus = HumanInputFormStatus.WAITING,
) -> HumanInputForm:
    form = HumanInputForm(
        id=form_id,
        tenant_id=tenant_id,
        app_id="app",
        workflow_run_id=workflow_run_id,
        conversation_id=None,
        form_kind=HumanInputFormKind.RUNTIME,
        node_id=node_id,
        form_definition=_make_form_definition_json(include_expiration_time=True),
        rendered_content="<p>x</p>",
        expiration_time=naive_utc_now() + timedelta(hours=1),
        status=status,
    )
    session.add(form)
    session.commit()
    return form


def _persist_recipient(
    session: Session,
    *,
    form_id: str,
    recipient_id: str = "recipient-1",
    recipient_type: RecipientType = RecipientType.STANDALONE_WEB_APP,
    access_token: str = "token-1",
) -> HumanInputFormRecipient:
    delivery = HumanInputDelivery(
        id=f"delivery-{recipient_id}",
        form_id=form_id,
        delivery_method_type=DeliveryMethodType.WEBAPP,
        delivery_config_id=None,
        channel_payload="{}",
    )
    recipient = HumanInputFormRecipient(
        id=recipient_id,
        form_id=form_id,
        delivery_id=delivery.id,
        recipient_type=recipient_type,
        recipient_payload="{}",
        access_token=access_token,
    )
    session.add_all([delivery, recipient])
    session.commit()
    return recipient


def test_recipient_entity_token_raises_when_missing() -> None:
    recipient = HumanInputFormRecipient(
        id="r1",
        form_id="f1",
        delivery_id="d1",
        recipient_type=RecipientType.CONSOLE,
        recipient_payload="{}",
        access_token=None,
    )
    entity = _HumanInputFormRecipientEntityImpl(recipient)
    with pytest.raises(AssertionError, match="access_token should not be None"):
        _ = entity.token


def test_recipient_entity_id_and_token_success(repository_session: Session) -> None:
    form = _persist_form(repository_session)
    recipient = _persist_recipient(repository_session, form_id=form.id, recipient_id="r1", access_token="tok")
    entity = _HumanInputFormRecipientEntityImpl(recipient)
    assert entity.id == "r1"
    assert entity.token == "tok"


def test_form_entity_submission_token_prefers_console_then_webapp_then_none(repository_session: Session) -> None:
    form = _persist_form(repository_session, form_id="f1")
    console = _persist_recipient(
        repository_session,
        form_id=form.id,
        recipient_id="c1",
        recipient_type=RecipientType.CONSOLE,
        access_token="ctok",
    )
    webapp = _persist_recipient(
        repository_session,
        form_id=form.id,
        recipient_id="w1",
        recipient_type=RecipientType.STANDALONE_WEB_APP,
        access_token="wtok",
    )

    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[webapp, console])
    assert entity.submission_token == "ctok"

    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[webapp])
    assert entity.submission_token == "wtok"

    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[])
    assert entity.submission_token is None


def test_form_entity_submitted_data_parsed(repository_session: Session) -> None:
    form = _persist_form(repository_session, form_id="f1")
    form.submitted_data = '{"a": 1}'
    form.submitted_at = naive_utc_now()
    repository_session.commit()
    entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[])
    assert entity.submitted is True
    assert entity.submitted_data == {"a": 1}
    assert entity.rendered_content == "<p>x</p>"
    assert entity.selected_action_id is None
    assert entity.status == HumanInputFormStatus.WAITING


def test_form_record_from_models_injects_expiration_time_when_missing(repository_session: Session) -> None:
    expiration = naive_utc_now()
    form = _persist_form(repository_session, form_id="f1", workflow_run_id=None)
    form.form_definition = _make_form_definition_json(include_expiration_time=False)
    form.expiration_time = expiration
    form.submitted_data = '{"k": "v"}'
    repository_session.commit()
    record = HumanInputFormRecord.from_models(form, None)
    assert record.definition.expiration_time == expiration
    assert record.submitted_data == {"k": "v"}
    assert record.submitted is False


def test_create_email_recipients_from_resolved_dedupes_and_skips_blank() -> None:
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


def test_query_workspace_members_by_ids_empty_returns_empty(repository_session: Session) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    assert repo._query_workspace_members_by_ids(session=repository_session, restrict_to_user_ids=["", ""]) == []


def test_query_workspace_members_by_ids_maps_rows_and_scopes_tenant(repository_session: Session) -> None:
    accounts = [
        Account(name="One", email="a@example.com"),
        Account(name="Two", email="b@example.com"),
        Account(name="Other", email="other@example.com"),
    ]
    repository_session.add_all(accounts)
    repository_session.flush()
    repository_session.add_all(
        [
            TenantAccountJoin(tenant_id="tenant", account_id=accounts[0].id, role=TenantAccountRole.NORMAL),
            TenantAccountJoin(tenant_id="tenant", account_id=accounts[1].id, role=TenantAccountRole.NORMAL),
            TenantAccountJoin(tenant_id="other-tenant", account_id=accounts[2].id, role=TenantAccountRole.NORMAL),
        ]
    )
    repository_session.commit()
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    rows = repo._query_workspace_members_by_ids(
        session=repository_session,
        restrict_to_user_ids=[accounts[0].id, accounts[1].id, accounts[2].id],
    )
    assert set(rows) == {
        _WorkspaceMemberInfo(user_id=accounts[0].id, email="a@example.com"),
        _WorkspaceMemberInfo(user_id=accounts[1].id, email="b@example.com"),
    }


def test_query_all_workspace_members_maps_rows(repository_session: Session) -> None:
    account = Account(name="One", email="a@example.com")
    repository_session.add(account)
    repository_session.flush()
    repository_session.add(TenantAccountJoin(tenant_id="tenant", account_id=account.id, role=TenantAccountRole.NORMAL))
    repository_session.commit()
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    rows = repo._query_all_workspace_members(session=repository_session)
    assert rows == [_WorkspaceMemberInfo(user_id=account.id, email="a@example.com")]


def test_repository_init_sets_tenant_id() -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    assert repo._tenant_id == "tenant"


def test_delivery_method_to_model_webapp_creates_delivery_and_recipient(
    repository_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    monkeypatch.setattr("core.repositories.human_input_repository.uuidv7", lambda: "del-1")
    result = repo._delivery_method_to_model(
        session=repository_session, form_id="form-1", delivery_method=WebAppDeliveryMethod()
    )
    assert result.delivery.id == "del-1"
    assert result.delivery.form_id == "form-1"
    assert len(result.recipients) == 1
    assert result.recipients[0].recipient_type == RecipientType.STANDALONE_WEB_APP


def test_delivery_method_to_model_email_uses_build_email_recipients(
    repository_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    monkeypatch.setattr("core.repositories.human_input_repository.uuidv7", lambda: "del-1")
    called: dict[str, Any] = {}

    def fake_build(*, session: Session, form_id: str, delivery_id: str, recipients_config: Any) -> list[Any]:
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
    result = repo._delivery_method_to_model(session=repository_session, form_id="form-1", delivery_method=method)
    assert result.recipients == ["r"]
    assert called["session"] is repository_session
    assert called["delivery_id"] == "del-1"


def test_build_email_recipients_uses_all_members_when_whole_workspace(
    repository_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
    monkeypatch.setattr(
        repo,
        "_query_all_workspace_members",
        lambda *, session: [_WorkspaceMemberInfo(user_id="u", email="a@example.com")],
    )
    monkeypatch.setattr(repo, "_create_email_recipients_from_resolved", lambda **_: ["ok"])
    recipients = repo._build_email_recipients(
        session=repository_session,
        form_id="f",
        delivery_id="d",
        recipients_config=EmailRecipients(include_bound_group=True, items=[ExternalRecipient(email="e@example.com")]),
    )
    assert recipients == ["ok"]


def test_build_email_recipients_uses_selected_members_when_not_whole_workspace(
    repository_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant")

    def fake_query(*, session: Any, restrict_to_user_ids: Sequence[str]) -> list[_WorkspaceMemberInfo]:
        assert restrict_to_user_ids == ["u1"]
        return [_WorkspaceMemberInfo(user_id="u1", email="a@example.com")]

    monkeypatch.setattr(repo, "_query_workspace_members_by_ids", fake_query)
    monkeypatch.setattr(repo, "_create_email_recipients_from_resolved", lambda **_: ["ok"])
    recipients = repo._build_email_recipients(
        session=repository_session,
        form_id="f",
        delivery_id="d",
        recipients_config=EmailRecipients(
            include_bound_group=False,
            items=[MemberRecipient(reference_id="u1"), ExternalRecipient(email="e@example.com")],
        ),
    )
    assert recipients == ["ok"]


def test_get_form_returns_entity_and_none_when_missing(repository_session: Session) -> None:
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant", workflow_execution_id="run")
    assert repo.get_form("node") is None

    form = _persist_form(repository_session, form_id="f1")
    _persist_form(repository_session, form_id="other-tenant-form", tenant_id="other-tenant")
    recipient = _persist_recipient(repository_session, form_id=form.id, recipient_id="r1", access_token="tok")
    repo = HumanInputFormRepositoryImpl(tenant_id="tenant", workflow_execution_id="run")
    entity = repo.get_form("node")
    assert entity is not None
    assert entity.id == "f1"
    assert entity.recipients[0].id == "r1"
    assert entity.recipients[0].token == "tok"


def test_create_form_adds_console_and_backstage_recipients(
    repository_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixed_now = datetime(2024, 1, 1, 0, 0, 0)
    monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

    ids = iter(["form-id", "del-web", "del-console", "del-backstage"])
    monkeypatch.setattr("core.repositories.human_input_repository.uuidv7", lambda: next(ids))

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
        user_actions=[UserActionConfig(id="submit", title="Submit")],
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
    assert entity.submission_token is not None
    assert len(entity.recipients) == 3
    repository_session.expire_all()
    persisted_form = repository_session.get(HumanInputForm, "form-id")
    assert persisted_form is not None
    assert persisted_form.status == HumanInputFormStatus.WAITING
    recipients = repository_session.scalars(
        select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id == "form-id")
    ).all()
    assert {recipient.recipient_type for recipient in recipients} == {
        RecipientType.STANDALONE_WEB_APP,
        RecipientType.CONSOLE,
        RecipientType.BACKSTAGE,
    }


def test_submission_get_by_token_returns_none_when_missing(repository_session: Session) -> None:
    repo = HumanInputFormSubmissionRepository()
    assert repo.get_by_token("tok") is None


def test_submission_repository_init_no_args() -> None:
    repo = HumanInputFormSubmissionRepository()
    assert isinstance(repo, HumanInputFormSubmissionRepository)


def test_submission_get_by_token_and_get_by_form_id_success_paths(repository_session: Session) -> None:
    form = _persist_form(repository_session, form_id="f1", workflow_run_id=None)
    recipient = _persist_recipient(repository_session, form_id=form.id, recipient_id="r1", access_token="tok")
    repo = HumanInputFormSubmissionRepository()
    record = repo.get_by_token("tok")
    assert record is not None
    assert record.access_token == "tok"

    record = repo.get_by_form_id_and_recipient_type(form_id=form.id, recipient_type=RecipientType.STANDALONE_WEB_APP)
    assert record is not None
    assert record.recipient_id == "r1"

    record = repo.get_by_form_id(form.id)
    assert record is not None
    assert record.form_id == form.id
    assert record.recipient_id is None


def test_submission_get_by_form_id_returns_none_on_missing(repository_session: Session) -> None:
    repo = HumanInputFormSubmissionRepository()
    assert repo.get_by_form_id_and_recipient_type(form_id="f", recipient_type=RecipientType.CONSOLE) is None
    assert repo.get_by_form_id("f") is None


def test_mark_submitted_updates_and_raises_when_missing(
    repository_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixed_now = datetime(2024, 1, 1, 0, 0, 0)
    monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

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

    form = _persist_form(repository_session, form_id="f", workflow_run_id=None)
    recipient = _persist_recipient(
        repository_session,
        form_id=form.id,
        recipient_id="r",
        recipient_type=RecipientType.CONSOLE,
        access_token="tok",
    )
    record = repo.mark_submitted(
        form_id=form.id,
        recipient_id=recipient.id,
        selected_action_id="approve",
        form_data={"k": "v"},
        submission_user_id="u",
        submission_end_user_id="eu",
    )
    repository_session.expire_all()
    persisted = repository_session.get(HumanInputForm, form.id)
    assert persisted is not None
    assert persisted.status == HumanInputFormStatus.SUBMITTED
    assert persisted.submitted_at == fixed_now
    assert persisted.completed_by_recipient_id == recipient.id
    assert record.submitted_data == {"k": "v"}


def test_mark_submitted_serializes_select_and_file_payloads(
    repository_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixed_now = datetime(2024, 1, 1, 0, 0, 0)
    monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

    form = _persist_form(repository_session, form_id="f-complex", workflow_run_id=None)
    recipient = _persist_recipient(
        repository_session,
        form_id=form.id,
        recipient_id="r-complex",
        recipient_type=RecipientType.CONSOLE,
        access_token="tok",
    )

    payload = {
        "decision": "approve",
        "attachment": {
            "type": "document",
            "transfer_method": "remote_url",
            "remote_url": "https://example.com/file.txt",
            "filename": "file.txt",
            "extension": ".txt",
            "mime_type": "text/plain",
        },
        "attachments": [
            {
                "type": "document",
                "transfer_method": "remote_url",
                "remote_url": "https://example.com/first.txt",
                "filename": "first.txt",
                "extension": ".txt",
                "mime_type": "text/plain",
            },
            {
                "type": "document",
                "transfer_method": "remote_url",
                "remote_url": "https://example.com/second.txt",
                "filename": "second.txt",
                "extension": ".txt",
                "mime_type": "text/plain",
            },
        ],
    }

    repo = HumanInputFormSubmissionRepository()
    record = repo.mark_submitted(
        form_id=form.id,
        recipient_id=recipient.id,
        selected_action_id="approve",
        form_data=payload,
        submission_user_id="user-1",
        submission_end_user_id="end-user-1",
    )

    repository_session.expire_all()
    persisted = repository_session.get(HumanInputForm, form.id)
    assert persisted is not None
    assert json.loads(persisted.submitted_data or "") == payload
    assert record.submitted_data == payload


def test_mark_timeout_invalid_status_rolls_back(repository_session: Session) -> None:
    form = _persist_form(repository_session, form_id="f", workflow_run_id=None)
    repo = HumanInputFormSubmissionRepository()
    with pytest.raises(_InvalidTimeoutStatusError, match="invalid timeout status"):
        repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.SUBMITTED)  # type: ignore[arg-type]
    repository_session.expire_all()
    persisted = repository_session.get(HumanInputForm, form.id)
    assert persisted is not None
    assert persisted.status == HumanInputFormStatus.WAITING


def test_mark_timeout_already_timed_out_returns_record(repository_session: Session) -> None:
    form = _persist_form(
        repository_session,
        form_id="f",
        workflow_run_id=None,
        status=HumanInputFormStatus.TIMEOUT,
    )
    repo = HumanInputFormSubmissionRepository()
    record = repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.TIMEOUT, reason="r")
    assert record.status == HumanInputFormStatus.TIMEOUT


def test_mark_timeout_submitted_raises_form_not_found(repository_session: Session) -> None:
    form = _persist_form(
        repository_session,
        form_id="f",
        workflow_run_id=None,
        status=HumanInputFormStatus.SUBMITTED,
    )
    repo = HumanInputFormSubmissionRepository()
    with pytest.raises(FormNotFoundError, match="form already submitted"):
        repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.EXPIRED)


def test_mark_timeout_updates_fields(repository_session: Session) -> None:
    form = _persist_form(repository_session, form_id="f", workflow_run_id=None)
    form.selected_action_id = "a"
    form.submitted_data = "{}"
    form.submission_user_id = "u"
    form.submission_end_user_id = "eu"
    form.completed_by_recipient_id = "r"
    repository_session.commit()
    repo = HumanInputFormSubmissionRepository()
    record = repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.EXPIRED)
    repository_session.expire_all()
    persisted = repository_session.get(HumanInputForm, form.id)
    assert persisted is not None
    assert persisted.status == HumanInputFormStatus.EXPIRED
    assert persisted.selected_action_id is None
    assert persisted.submitted_data is None
    assert persisted.submission_user_id is None
    assert persisted.submission_end_user_id is None
    assert persisted.completed_by_recipient_id is None
    assert record.status == HumanInputFormStatus.EXPIRED


def test_mark_timeout_raises_when_form_missing(repository_session: Session) -> None:
    repo = HumanInputFormSubmissionRepository()
    with pytest.raises(FormNotFoundError, match="form not found"):
        repo.mark_timeout(form_id="missing", timeout_status=HumanInputFormStatus.TIMEOUT)
