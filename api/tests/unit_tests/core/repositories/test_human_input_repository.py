from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from datetime import datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.exc import SQLAlchemyError
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
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    HumanInputNodeData,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from libs.datetime_utils import naive_utc_now
from models import Account as _human_input_form_repository_impl_Account
from models import TenantAccountJoin as _human_input_form_repository_impl_TenantAccountJoin
from models.account import Account as _human_input_repository_Account
from models.account import TenantAccountJoin as _human_input_repository_TenantAccountJoin
from models.account import TenantAccountRole
from models.base import TypeBase
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
    StandaloneWebAppRecipientPayload,
)
from repositories.human_input_errors import FormAlreadyHandledError

"""Unit tests for HumanInputFormRepositoryImpl private helpers."""


def _build_repository() -> HumanInputFormRepositoryImpl:
    return HumanInputFormRepositoryImpl(tenant_id="tenant-id")


def _add_workspace_member(
    session: Session,
    *,
    user_id: str,
    email: str,
    tenant_id: str = "tenant-id",
) -> None:
    account = _human_input_form_repository_impl_Account(name=user_id, email=email)
    account.id = user_id
    session.add_all(
        [account, _human_input_form_repository_impl_TenantAccountJoin(tenant_id=tenant_id, account_id=user_id)]
    )
    session.commit()


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


def _human_input_form_repository_impl_persist_form(
    session: Session,
    form: HumanInputForm,
    recipients: list[HumanInputFormRecipient] | None = None,
) -> None:
    session.add(form)
    session.add_all(recipients or [])
    session.commit()


class TestHumanInputFormRepositoryImplCases:
    class TestHumanInputFormRepositoryImplHelpers:
        def test_build_email_recipients_with_member_and_external(
            self,
            monkeypatch: pytest.MonkeyPatch,
            sqlite_session: Session,
        ) -> None:
            repo = _build_repository()
            _add_workspace_member(sqlite_session, user_id="member-1", email="member@example.com")
            query_workspace_members_by_ids = repo._query_workspace_members_by_ids

            def query_members(session: Session, restrict_to_user_ids: list[str]) -> list[_WorkspaceMemberInfo]:
                assert session is sqlite_session
                return query_workspace_members_by_ids(
                    session=session,
                    restrict_to_user_ids=restrict_to_user_ids,
                )

            monkeypatch.setattr(repo, "_query_workspace_members_by_ids", query_members)

            recipients = repo._build_email_recipients(
                session=sqlite_session,
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

        def test_build_email_recipients_skips_unknown_members(self, sqlite_session: Session) -> None:
            repo = _build_repository()

            recipients = repo._build_email_recipients(
                session=sqlite_session,
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

        def test_build_email_recipients_whole_workspace_uses_all_members(self, sqlite_session: Session) -> None:
            repo = _build_repository()
            _add_workspace_member(sqlite_session, user_id="member-1", email="member1@example.com")
            _add_workspace_member(sqlite_session, user_id="member-2", email="member2@example.com")

            recipients = repo._build_email_recipients(
                session=sqlite_session,
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

        def test_build_email_recipients_dedupes_external_by_email(self, sqlite_session: Session) -> None:
            repo = _build_repository()

            recipients = repo._build_email_recipients(
                session=sqlite_session,
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

        def test_build_email_recipients_prefers_member_over_external_by_email(self, sqlite_session: Session) -> None:
            repo = _build_repository()
            _add_workspace_member(sqlite_session, user_id="member-1", email="shared@example.com")

            recipients = repo._build_email_recipients(
                session=sqlite_session,
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
            sqlite_session: Session,
        ) -> None:
            repo = _build_repository()
            _add_workspace_member(sqlite_session, user_id="member-1", email="member1@example.com")
            _add_workspace_member(sqlite_session, user_id="member-2", email="member2@example.com")

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

            result = repo._delivery_method_to_model(session=sqlite_session, form_id="form-id", delivery_method=method)

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

    class TestHumanInputFormRepositoryImplPublicMethods:
        @pytest.mark.parametrize("mismatched_scope", ["tenant_id", "app_id", "workflow_run_id", "node_id", "id"])
        def test_mark_timeout_rejects_form_outside_execution_scope(
            self, sqlite_session: Session, mismatched_scope: str
        ) -> None:
            form = _make_form(expiration_time=naive_utc_now() - timedelta(minutes=1))
            setattr(form, mismatched_scope, "other-value")
            _human_input_form_repository_impl_persist_form(sqlite_session, form)
            repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", app_id="app-id", workflow_execution_id="run-1")

            with pytest.raises(FormNotFoundError):
                repo.mark_timeout("node-1", form_id="form-1")

            sqlite_session.refresh(form)
            assert form.status == HumanInputFormStatus.WAITING

        @pytest.mark.parametrize("already_submitted", [False, True])
        def test_mark_timeout_preserves_waiting_form_that_is_not_eligible(
            self, sqlite_session: Session, already_submitted: bool
        ) -> None:
            form = _make_form(
                expiration_time=naive_utc_now() + timedelta(minutes=-1 if already_submitted else 1),
                submitted_at=naive_utc_now() if already_submitted else None,
            )
            _human_input_form_repository_impl_persist_form(sqlite_session, form)
            repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", app_id="app-id", workflow_execution_id="run-1")

            entity = repo.mark_timeout("node-1", form_id="form-1")

            assert entity.status == HumanInputFormStatus.WAITING
            assert entity.submitted == already_submitted
            sqlite_session.refresh(form)
            assert form.status == HumanInputFormStatus.WAITING

        def test_get_form_returns_entity_and_recipients(self, sqlite_session: Session):
            form = _make_form()
            recipient = _make_recipient(form.id)
            other_tenant_form = _make_form(form_id="form-2", tenant_id="other-tenant")
            sqlite_session.add(other_tenant_form)
            _human_input_form_repository_impl_persist_form(sqlite_session, form, [recipient])
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

        def test_get_form_returns_unsubmitted_state(self, sqlite_session: Session):
            form = _make_form()
            _human_input_form_repository_impl_persist_form(sqlite_session, form)
            repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", workflow_execution_id=form.workflow_run_id)

            entity = repo.get_form(form.node_id)

            assert entity is not None
            assert entity.submitted is False
            assert entity.selected_action_id is None
            assert entity.submitted_data is None

        def test_get_form_returns_submission_when_completed(self, sqlite_session: Session):
            form = _make_form(
                selected_action_id="approve",
                submitted_data='{"field": "value"}',
                submitted_at=naive_utc_now(),
            )
            _human_input_form_repository_impl_persist_form(sqlite_session, form)
            repo = HumanInputFormRepositoryImpl(tenant_id="tenant-id", workflow_execution_id=form.workflow_run_id)

            entity = repo.get_form(form.node_id)

            assert entity is not None
            assert entity.submitted is True
            assert entity.selected_action_id == "approve"
            assert entity.submitted_data == {"field": "value"}

    class TestHumanInputFormSubmissionRepository:
        def test_get_by_token_returns_record(self, sqlite_session: Session):
            form = _make_form(tenant_id="tenant-1")
            recipient = _make_recipient(form.id)
            _human_input_form_repository_impl_persist_form(sqlite_session, form, [recipient])
            repo = HumanInputFormSubmissionRepository()

            record = repo.get_by_token("token-123")

            assert record is not None
            assert record.form_id == form.id
            assert record.recipient_type == RecipientType.STANDALONE_WEB_APP
            assert record.submitted is False

        def test_get_by_form_id_and_recipient_type_uses_recipient(self, sqlite_session: Session):
            form = _make_form(tenant_id="tenant-1")
            recipient = _make_recipient(form.id)
            _human_input_form_repository_impl_persist_form(sqlite_session, form, [recipient])
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
            sqlite_session: Session,
        ):
            fixed_now = datetime(2024, 1, 1, 0, 0, 0)
            monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

            form = _make_form(tenant_id="tenant-1", expiration_time=fixed_now)
            recipient = _make_recipient(form.id)
            _human_input_form_repository_impl_persist_form(sqlite_session, form, [recipient])
            repo = HumanInputFormSubmissionRepository()

            record: HumanInputFormRecord = repo.mark_submitted(
                form_id=form.id,
                recipient_id=recipient.id,
                selected_action_id="approve",
                form_data={"field": "value"},
                submission_user_id="user-1",
                submission_end_user_id="end-user-1",
            )

            sqlite_session.expire_all()
            persisted_form = sqlite_session.get(HumanInputForm, form.id)
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
            sqlite_session: Session,
            sqlite_engine: Engine,
        ) -> None:
            form = _make_form(tenant_id="tenant-1")
            recipient = _make_recipient(form.id)
            _human_input_form_repository_impl_persist_form(sqlite_session, form, [recipient])
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

            sqlite_session.expire_all()
            persisted_form = sqlite_session.get(HumanInputForm, form.id)
            assert persisted_form is not None
            assert persisted_form.status == HumanInputFormStatus.WAITING
            assert persisted_form.selected_action_id is None
            assert persisted_form.submitted_data is None
            assert persisted_form.submitted_at is None


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


def _human_input_repository_persist_form(
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


class TestHumanInputRepositoryCases:
    @staticmethod
    @pytest.fixture
    def repository_session(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
        """Bind repository-owned sessions to an isolated SQLite database."""

        tables = [
            HumanInputForm.__table__,
            HumanInputDelivery.__table__,
            HumanInputFormRecipient.__table__,
            _human_input_repository_Account.__table__,
            _human_input_repository_TenantAccountJoin.__table__,
        ]
        TypeBase.metadata.create_all(sqlite_engine, tables=tables)
        repository_session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        monkeypatch.setattr(
            "core.repositories.human_input_repository.session_factory.create_session",
            repository_session_factory,
        )
        with repository_session_factory() as session:
            yield session

    @staticmethod
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

    @staticmethod
    def test_recipient_entity_id_and_token_success(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(repository_session)
        recipient = _persist_recipient(repository_session, form_id=form.id, recipient_id="r1", access_token="tok")
        entity = _HumanInputFormRecipientEntityImpl(recipient)
        assert entity.id == "r1"
        assert entity.token == "tok"

    @staticmethod
    def test_form_entity_submission_token_prefers_console_then_webapp_then_none(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(repository_session, form_id="f1")
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

    @staticmethod
    def test_form_entity_submitted_data_parsed(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(repository_session, form_id="f1")
        form.submitted_data = '{"a": 1}'
        form.submitted_at = naive_utc_now()
        repository_session.commit()
        entity = _HumanInputFormEntityImpl(form_model=form, recipient_models=[])
        assert entity.submitted is True
        assert entity.submitted_data == {"a": 1}
        assert entity.rendered_content == "<p>x</p>"
        assert entity.selected_action_id is None
        assert entity.status == HumanInputFormStatus.WAITING

    @staticmethod
    def test_form_record_from_models_injects_expiration_time_when_missing(repository_session: Session) -> None:
        expiration = naive_utc_now()
        form = _human_input_repository_persist_form(repository_session, form_id="f1", workflow_run_id=None)
        form.form_definition = _make_form_definition_json(include_expiration_time=False)
        form.expiration_time = expiration
        form.submitted_data = '{"k": "v"}'
        repository_session.commit()
        record = HumanInputFormRecord.from_models(form, None)
        assert record.definition.expiration_time == expiration
        assert record.submitted_data == {"k": "v"}
        assert record.submitted is False

    @staticmethod
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

    @staticmethod
    def test_query_workspace_members_by_ids_empty_returns_empty(repository_session: Session) -> None:
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
        assert repo._query_workspace_members_by_ids(session=repository_session, restrict_to_user_ids=["", ""]) == []

    @staticmethod
    def test_query_workspace_members_by_ids_maps_rows_and_scopes_tenant(repository_session: Session) -> None:
        accounts = [
            _human_input_repository_Account(name="One", email="a@example.com"),
            _human_input_repository_Account(name="Two", email="b@example.com"),
            _human_input_repository_Account(name="Other", email="other@example.com"),
        ]
        repository_session.add_all(accounts)
        repository_session.flush()
        repository_session.add_all(
            [
                _human_input_repository_TenantAccountJoin(
                    tenant_id="tenant", account_id=accounts[0].id, role=TenantAccountRole.NORMAL
                ),
                _human_input_repository_TenantAccountJoin(
                    tenant_id="tenant", account_id=accounts[1].id, role=TenantAccountRole.NORMAL
                ),
                _human_input_repository_TenantAccountJoin(
                    tenant_id="other-tenant", account_id=accounts[2].id, role=TenantAccountRole.NORMAL
                ),
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

    @staticmethod
    def test_query_all_workspace_members_maps_rows(repository_session: Session) -> None:
        account = _human_input_repository_Account(name="One", email="a@example.com")
        repository_session.add(account)
        repository_session.flush()
        repository_session.add(
            _human_input_repository_TenantAccountJoin(
                tenant_id="tenant", account_id=account.id, role=TenantAccountRole.NORMAL
            )
        )
        repository_session.commit()
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
        rows = repo._query_all_workspace_members(session=repository_session)
        assert rows == [_WorkspaceMemberInfo(user_id=account.id, email="a@example.com")]

    @staticmethod
    def test_repository_init_sets_tenant_id() -> None:
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
        assert repo._tenant_id == "tenant"

    @staticmethod
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

    @staticmethod
    def test_delivery_method_to_model_email_uses_build_email_recipients(
        repository_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant")
        monkeypatch.setattr("core.repositories.human_input_repository.uuidv7", lambda: "del-1")
        called: dict[str, Any] = {}

        def fake_build(*, session: Session, form_id: str, delivery_id: str, recipients_config: Any) -> list[Any]:
            called.update(
                {
                    "session": session,
                    "form_id": form_id,
                    "delivery_id": delivery_id,
                    "recipients_config": recipients_config,
                }
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

    @staticmethod
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
            recipients_config=EmailRecipients(
                include_bound_group=True, items=[ExternalRecipient(email="e@example.com")]
            ),
        )
        assert recipients == ["ok"]

    @staticmethod
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

    @staticmethod
    def test_get_form_returns_entity_and_none_when_missing(repository_session: Session) -> None:
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant", workflow_execution_id="run")
        assert repo.get_form("node") is None

        form = _human_input_repository_persist_form(repository_session, form_id="f1")
        _human_input_repository_persist_form(repository_session, form_id="other-tenant-form", tenant_id="other-tenant")
        _persist_recipient(repository_session, form_id=form.id, recipient_id="r1", access_token="tok")
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant", workflow_execution_id="run")
        entity = repo.get_form("node")
        assert entity is not None
        assert entity.id == "f1"
        assert entity.recipients[0].id == "r1"
        assert entity.recipients[0].token == "tok"

    @staticmethod
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

    @staticmethod
    def test_create_runtime_form_requires_workflow_even_when_conversation_is_present() -> None:
        repo = HumanInputFormRepositoryImpl(tenant_id="tenant", app_id="app")
        params = FormCreateParams(
            workflow_execution_id=None,
            conversation_id="conversation",
            node_id="node",
            form_config=HumanInputNodeData(
                title="Title",
                delivery_methods=[],
                form_content="hello",
                inputs=[],
                user_actions=[UserActionConfig(id="submit", title="Submit")],
            ),
            rendered_content="hello",
            delivery_methods=[],
            display_in_ui=True,
            resolved_default_values={},
        )
        with pytest.raises(ValueError, match="requires a workflow_execution_id"):
            repo.create_form(params)

    @staticmethod
    def test_submission_get_by_token_returns_none_when_missing_or_form_missing(repository_session: Session) -> None:
        repo = HumanInputFormSubmissionRepository()
        assert repo.get_by_token("tok") is None

        _persist_recipient(repository_session, form_id="missing-form", access_token="orphan-token")
        assert repo.get_by_token("orphan-token") is None

    @staticmethod
    def test_submission_repository_init_no_args() -> None:
        repo = HumanInputFormSubmissionRepository()
        assert isinstance(repo, HumanInputFormSubmissionRepository)

    @staticmethod
    def test_submission_get_by_token_and_get_by_form_id_success_paths(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(repository_session, form_id="f1", workflow_run_id=None)
        _persist_recipient(repository_session, form_id=form.id, recipient_id="r1", access_token="tok")
        repo = HumanInputFormSubmissionRepository()
        record = repo.get_by_token("tok")
        assert record is not None
        assert record.access_token == "tok"

        record = repo.get_by_form_id_and_recipient_type(
            form_id=form.id, recipient_type=RecipientType.STANDALONE_WEB_APP
        )
        assert record is not None
        assert record.recipient_id == "r1"

        record = repo.get_by_form_id(form.id)
        assert record is not None
        assert record.form_id == form.id
        assert record.recipient_id is None

    @staticmethod
    def test_submission_get_by_form_id_returns_none_on_missing(repository_session: Session) -> None:
        repo = HumanInputFormSubmissionRepository()
        assert repo.get_by_form_id_and_recipient_type(form_id="f", recipient_type=RecipientType.CONSOLE) is None
        assert repo.get_by_form_id("f") is None

    @staticmethod
    def test_submission_batch_materializes_requested_forms_in_one_read(repository_session: Session) -> None:
        _human_input_repository_persist_form(repository_session, form_id="first", status=HumanInputFormStatus.SUBMITTED)
        _human_input_repository_persist_form(repository_session, form_id="second", status=HumanInputFormStatus.TIMEOUT)
        _human_input_repository_persist_form(repository_session, form_id="unrequested")
        statements: list[str] = []

        def record_statement(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
            statements.append(statement)

        engine = repository_session.get_bind()
        event.listen(engine, "before_cursor_execute", record_statement)
        try:
            records = HumanInputFormSubmissionRepository().get_by_form_ids(
                ["second", "missing", "first", "first"], tenant_id="tenant", app_id="app", workflow_run_id="run"
            )
            assert len(statements) == 1
            assert set(records) == {"first", "second"}
            assert records["first"].status == HumanInputFormStatus.SUBMITTED
            assert records["second"].definition.user_actions[0].id == "submit"
            assert records["second"].status == HumanInputFormStatus.TIMEOUT
            # Materialized records remain usable after the repository's session closes.
            assert len(statements) == 1
            assert (
                HumanInputFormSubmissionRepository().get_by_form_ids(
                    [], tenant_id="tenant", app_id="app", workflow_run_id="run"
                )
                == {}
            )
            assert len(statements) == 1
        finally:
            event.remove(engine, "before_cursor_execute", record_statement)

    @staticmethod
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

        form = _human_input_repository_persist_form(repository_session, form_id="f", workflow_run_id=None)
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

    @staticmethod
    @pytest.mark.parametrize("status", [HumanInputFormStatus.EXPIRED, HumanInputFormStatus.SUBMITTED])
    def test_mark_submitted_does_not_overwrite_a_concurrent_stop_or_submission(
        repository_session: Session, status: HumanInputFormStatus
    ) -> None:
        form = _human_input_repository_persist_form(repository_session, form_id="stopped-form", workflow_run_id=None)
        form.status = status
        repository_session.commit()
        with pytest.raises(FormAlreadyHandledError) as error:
            HumanInputFormSubmissionRepository().mark_submitted(
                form_id=form.id,
                recipient_id=None,
                selected_action_id="approve",
                form_data={"note": "late submission"},
                submission_user_id=None,
                submission_end_user_id=None,
            )
        assert error.value.status == status
        repository_session.expire_all()
        assert form.status == status
        assert form.submitted_data is None

    @staticmethod
    def test_mark_submitted_serializes_select_and_file_payloads(
        repository_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fixed_now = datetime(2024, 1, 1, 0, 0, 0)
        monkeypatch.setattr("core.repositories.human_input_repository.naive_utc_now", lambda: fixed_now)

        form = _human_input_repository_persist_form(repository_session, form_id="f-complex", workflow_run_id=None)
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

    @staticmethod
    def test_mark_timeout_invalid_status_rolls_back(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(repository_session, form_id="f", workflow_run_id=None)
        repo = HumanInputFormSubmissionRepository()
        with pytest.raises(_InvalidTimeoutStatusError, match="invalid timeout status"):
            repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.SUBMITTED)  # type: ignore[arg-type]
        repository_session.expire_all()
        persisted = repository_session.get(HumanInputForm, form.id)
        assert persisted is not None
        assert persisted.status == HumanInputFormStatus.WAITING

    @staticmethod
    def test_mark_timeout_already_timed_out_returns_record(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(
            repository_session,
            form_id="f",
            workflow_run_id=None,
            status=HumanInputFormStatus.TIMEOUT,
        )
        repo = HumanInputFormSubmissionRepository()
        record = repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.TIMEOUT, reason="r")
        assert record.status == HumanInputFormStatus.TIMEOUT

    @staticmethod
    def test_mark_timeout_submitted_raises_form_not_found(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(
            repository_session,
            form_id="f",
            workflow_run_id=None,
            status=HumanInputFormStatus.SUBMITTED,
        )
        repo = HumanInputFormSubmissionRepository()
        with pytest.raises(FormNotFoundError, match="form already submitted"):
            repo.mark_timeout(form_id=form.id, timeout_status=HumanInputFormStatus.EXPIRED)

    @staticmethod
    def test_mark_timeout_updates_fields(repository_session: Session) -> None:
        form = _human_input_repository_persist_form(repository_session, form_id="f", workflow_run_id=None)
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

    @staticmethod
    def test_mark_timeout_raises_when_form_missing(repository_session: Session) -> None:
        repo = HumanInputFormSubmissionRepository()
        with pytest.raises(FormNotFoundError, match="form not found"):
            repo.mark_timeout(form_id="missing", timeout_status=HumanInputFormStatus.TIMEOUT)
