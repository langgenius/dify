"""Unit tests for HumanInputFormRepositoryImpl private helpers."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.human_input_repository import (
    HumanInputFormRecord,
    HumanInputFormRepositoryImpl,
    HumanInputFormSubmissionRepository,
)
from core.workflow.human_input_adapter import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    MemberRecipient,
)
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from libs.datetime_utils import naive_utc_now
from models import Account, TenantAccountJoin
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
    StandaloneWebAppRecipientPayload,
)

TABLES = (Account, TenantAccountJoin, HumanInputForm, HumanInputDelivery, HumanInputFormRecipient)


@pytest.fixture(autouse=True)
def sqlite_database(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> Iterator[Session]:
    """Create required tables and bind repository-owned sessions to SQLite."""
    HumanInputForm.metadata.create_all(sqlite_engine, tables=[model.__table__ for model in TABLES])
    sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr("core.db.session_factory._session_maker", sqlite_session_maker)
    with sqlite_session_maker() as session:
        yield session


def _build_repository() -> HumanInputFormRepositoryImpl:
    return HumanInputFormRepositoryImpl(tenant_id="tenant-id")


def _add_workspace_member(
    session: Session,
    *,
    user_id: str,
    email: str,
    tenant_id: str = "tenant-id",
) -> None:
    account = Account(name=user_id, email=email)
    account.id = user_id
    session.add_all([account, TenantAccountJoin(tenant_id=tenant_id, account_id=user_id)])
    session.commit()


class TestHumanInputFormRepositoryImplHelpers:
    def test_build_email_recipients_with_member_and_external(self, sqlite_database: Session) -> None:
        repo = _build_repository()
        _add_workspace_member(sqlite_database, user_id="member-1", email="member@example.com")

        recipients = repo._build_email_recipients(
            session=sqlite_database,
            form_id="form-id",
            delivery_id="delivery-id",
            recipients_config=EmailRecipients(
                include_bound_group=False,
                items=[
                    MemberRecipient(reference_id="member-1"),
                    ExternalRecipient(email="external@example.com"),
                ],
            ),
        )

        assert len(recipients) == 2
        member_recipient = next(r for r in recipients if r.recipient_type == RecipientType.EMAIL_MEMBER)
        external_recipient = next(r for r in recipients if r.recipient_type == RecipientType.EMAIL_EXTERNAL)

        member_payload = EmailMemberRecipientPayload.model_validate_json(member_recipient.recipient_payload)
        assert member_payload.user_id == "member-1"
        assert member_payload.email == "member@example.com"

        external_payload = EmailExternalRecipientPayload.model_validate_json(external_recipient.recipient_payload)
        assert external_payload.email == "external@example.com"

    def test_build_email_recipients_skips_unknown_members(self, sqlite_database: Session) -> None:
        repo = _build_repository()

        recipients = repo._build_email_recipients(
            session=sqlite_database,
            form_id="form-id",
            delivery_id="delivery-id",
            recipients_config=EmailRecipients(
                include_bound_group=False,
                items=[
                    MemberRecipient(reference_id="missing-member"),
                    ExternalRecipient(email="external@example.com"),
                ],
            ),
        )

        assert len(recipients) == 1
        assert recipients[0].recipient_type == RecipientType.EMAIL_EXTERNAL

    def test_build_email_recipients_whole_workspace_uses_all_members(self, sqlite_database: Session) -> None:
        repo = _build_repository()
        _add_workspace_member(sqlite_database, user_id="member-1", email="member1@example.com")
        _add_workspace_member(sqlite_database, user_id="member-2", email="member2@example.com")

        recipients = repo._build_email_recipients(
            session=sqlite_database,
            form_id="form-id",
            delivery_id="delivery-id",
            recipients_config=EmailRecipients(
                include_bound_group=True,
                items=[],
            ),
        )

        assert len(recipients) == 2
        emails = {EmailMemberRecipientPayload.model_validate_json(r.recipient_payload).email for r in recipients}
        assert emails == {"member1@example.com", "member2@example.com"}

    def test_build_email_recipients_dedupes_external_by_email(self, sqlite_database: Session) -> None:
        repo = _build_repository()

        recipients = repo._build_email_recipients(
            session=sqlite_database,
            form_id="form-id",
            delivery_id="delivery-id",
            recipients_config=EmailRecipients(
                include_bound_group=False,
                items=[
                    ExternalRecipient(email="external@example.com"),
                    ExternalRecipient(email="external@example.com"),
                ],
            ),
        )

        assert len(recipients) == 1

    def test_build_email_recipients_prefers_member_over_external_by_email(self, sqlite_database: Session) -> None:
        repo = _build_repository()
        _add_workspace_member(sqlite_database, user_id="member-1", email="shared@example.com")

        recipients = repo._build_email_recipients(
            session=sqlite_database,
            form_id="form-id",
            delivery_id="delivery-id",
            recipients_config=EmailRecipients(
                include_bound_group=False,
                items=[
                    MemberRecipient(reference_id="member-1"),
                    ExternalRecipient(email="shared@example.com"),
                ],
            ),
        )

        assert len(recipients) == 1
        assert recipients[0].recipient_type == RecipientType.EMAIL_MEMBER

    def test_delivery_method_to_model_includes_external_recipients_with_whole_workspace(
        self,
        sqlite_database: Session,
    ) -> None:
        repo = _build_repository()
        _add_workspace_member(sqlite_database, user_id="member-1", email="member1@example.com")
        _add_workspace_member(sqlite_database, user_id="member-2", email="member2@example.com")

        method = EmailDeliveryMethod(
            config=EmailDeliveryConfig(
                recipients=EmailRecipients(
                    include_bound_group=True,
                    items=[ExternalRecipient(email="external@example.com")],
                ),
                subject="subject",
                body="body",
            )
        )

        result = repo._delivery_method_to_model(session=sqlite_database, form_id="form-id", delivery_method=method)

        assert len(result.recipients) == 3
        member_emails = {
            EmailMemberRecipientPayload.model_validate_json(r.recipient_payload).email
            for r in result.recipients
            if r.recipient_type == RecipientType.EMAIL_MEMBER
        }
        assert member_emails == {"member1@example.com", "member2@example.com"}
        external_payload = EmailExternalRecipientPayload.model_validate_json(
            next(r for r in result.recipients if r.recipient_type == RecipientType.EMAIL_EXTERNAL).recipient_payload
        )
        assert external_payload.email == "external@example.com"


def _make_form_definition() -> str:
    return FormDefinition(
        form_content="hello",
        inputs=[],
        user_actions=[UserActionConfig(id="submit", title="Submit")],
        rendered_content="<p>hello</p>",
        expiration_time=naive_utc_now(),
    ).model_dump_json()


def _make_form(
    *,
    form_id: str = "form-1",
    workflow_run_id: str = "run-1",
    node_id: str = "node-1",
    tenant_id: str = "tenant-id",
    selected_action_id: str | None = None,
    submitted_data: str | None = None,
    submitted_at: datetime | None = None,
    expiration_time: datetime | None = None,
) -> HumanInputForm:
    return HumanInputForm(
        id=form_id,
        workflow_run_id=workflow_run_id,
        conversation_id=None,
        node_id=node_id,
        tenant_id=tenant_id,
        app_id="app-id",
        form_kind=HumanInputFormKind.RUNTIME,
        form_definition=_make_form_definition(),
        rendered_content="<p>hello</p>",
        expiration_time=expiration_time or naive_utc_now(),
        status=HumanInputFormStatus.WAITING,
        selected_action_id=selected_action_id,
        submitted_data=submitted_data,
        submitted_at=submitted_at,
    )


def _make_recipient(
    form_id: str,
    *,
    recipient_id: str = "recipient-1",
    recipient_type: RecipientType = RecipientType.STANDALONE_WEB_APP,
    access_token: str = "token-123",
) -> HumanInputFormRecipient:
    return HumanInputFormRecipient(
        id=recipient_id,
        form_id=form_id,
        delivery_id="delivery-1",
        recipient_type=recipient_type,
        access_token=access_token,
        recipient_payload=StandaloneWebAppRecipientPayload().model_dump_json(),
    )


def _persist_form(
    session: Session,
    form: HumanInputForm,
    recipients: list[HumanInputFormRecipient] | None = None,
) -> None:
    session.add(form)
    session.add_all(recipients or [])
    session.commit()


class TestHumanInputFormRepositoryImplPublicMethods:
    def test_get_form_returns_entity_and_recipients(self, sqlite_database: Session):
        form = _make_form()
        recipient = _make_recipient(form.id)
        other_tenant_form = _make_form(form_id="form-2", tenant_id="other-tenant")
        sqlite_database.add(other_tenant_form)
        _persist_form(sqlite_database, form, [recipient])
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", workflow_execution_id=form.workflow_run_id)

        entity = repo.get_form(form.node_id)

        assert entity is not None
        assert entity.id == form.id
        assert entity.submission_token == "token-123"
        assert len(entity.recipients) == 1
        assert entity.recipients[0].token == "token-123"

    def test_get_form_returns_none_when_missing(self):
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", workflow_execution_id="run-1")

        assert repo.get_form("node-1") is None

    def test_get_form_returns_unsubmitted_state(self, sqlite_database: Session):
        form = _make_form()
        _persist_form(sqlite_database, form)
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", workflow_execution_id=form.workflow_run_id)

        entity = repo.get_form(form.node_id)

        assert entity is not None
        assert entity.submitted is False
        assert entity.selected_action_id is None
        assert entity.submitted_data is None

    def test_get_form_returns_submission_when_completed(self, sqlite_database: Session):
        form = _make_form(
            selected_action_id="approve",
            submitted_data='{"field": "value"}',
            submitted_at=naive_utc_now(),
        )
        _persist_form(sqlite_database, form)
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", workflow_execution_id=form.workflow_run_id)

        entity = repo.get_form(form.node_id)

        assert entity is not None
        assert entity.submitted is True
        assert entity.selected_action_id == "approve"
        assert entity.submitted_data == {"field": "value"}


class TestHumanInputFormSubmissionRepository:
    def test_get_by_token_returns_record(self, sqlite_database: Session):
        form = _make_form(tenant_id="tenant-1")
        recipient = _make_recipient(form.id)
        _persist_form(sqlite_database, form, [recipient])
        repo = HumanInputFormSubmissionRepository()

        record = repo.get_by_token("token-123")

        assert record is not None
        assert record.form_id == form.id
        assert record.recipient_type == RecipientType.STANDALONE_WEB_APP
        assert record.submitted is False

    def test_get_by_form_id_and_recipient_type_uses_recipient(self, sqlite_database: Session):
        form = _make_form(tenant_id="tenant-1")
        recipient = _make_recipient(form.id)
        _persist_form(sqlite_database, form, [recipient])
        repo = HumanInputFormSubmissionRepository()

        record = repo.get_by_form_id_and_recipient_type(
            form_id=form.id,
            recipient_type=RecipientType.STANDALONE_WEB_APP,
        )

        assert record is not None
        assert record.recipient_id == recipient.id
        assert record.access_token == recipient.access_token

    def test_mark_submitted_updates_fields(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_database: Session,
    ):
        fixed_now = datetime(2024, 1, 1, 0, 0, 0)
        monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

        form = _make_form(tenant_id="tenant-1", expiration_time=fixed_now)
        recipient = _make_recipient(form.id)
        _persist_form(sqlite_database, form, [recipient])
        repo = HumanInputFormSubmissionRepository()

        record: HumanInputFormRecord = repo.mark_submitted(
            form_id=form.id,
            recipient_id=recipient.id,
            selected_action_id="approve",
            form_data={"field": "value"},
            submission_user_id="user-1",
            submission_end_user_id="end-user-1",
        )

        sqlite_database.expire_all()
        persisted_form = sqlite_database.get(HumanInputForm, form.id)
        assert persisted_form is not None
        assert persisted_form.selected_action_id == "approve"
        assert persisted_form.completed_by_recipient_id == recipient.id
        assert persisted_form.submission_user_id == "user-1"
        assert persisted_form.submission_end_user_id == "end-user-1"
        assert persisted_form.submitted_at == fixed_now
        assert record.submitted is True
        assert record.selected_action_id == "approve"
        assert record.submitted_data == {"field": "value"}

    def test_mark_submitted_rolls_back_on_database_failure(
        self,
        sqlite_database: Session,
        sqlite_engine: Engine,
    ) -> None:
        form = _make_form(tenant_id="tenant-1")
        recipient = _make_recipient(form.id)
        _persist_form(sqlite_database, form, [recipient])
        repo = HumanInputFormSubmissionRepository()

        def fail_form_update(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
            if statement.lstrip().upper().startswith("UPDATE HUMAN_INPUT_FORMS"):
                raise SQLAlchemyError("forced update failure")

        event.listen(sqlite_engine, "before_cursor_execute", fail_form_update)
        try:
            with pytest.raises(SQLAlchemyError, match="forced update failure"):
                repo.mark_submitted(
                    form_id=form.id,
                    recipient_id=recipient.id,
                    selected_action_id="approve",
                    form_data={"field": "value"},
                    submission_user_id="user-1",
                    submission_end_user_id="end-user-1",
                )
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", fail_form_update)

        sqlite_database.expire_all()
        persisted_form = sqlite_database.get(HumanInputForm, form.id)
        assert persisted_form is not None
        assert persisted_form.status == HumanInputFormStatus.WAITING
        assert persisted_form.selected_action_id is None
        assert persisted_form.submitted_data is None
        assert persisted_form.submitted_at is None
