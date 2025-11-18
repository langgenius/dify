"""Unit tests for HumanInputFormRepositoryImpl private helpers."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.repositories.human_input_reposotiry import (
    HumanInputFormRepositoryImpl,
    _WorkspaceMemberInfo,
)
from core.workflow.nodes.human_input.entities import ExternalRecipient, MemberRecipient
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
