"""TestContainers integration tests for HumanInputFormRepositoryImpl."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from core.repositories.human_input_repository import HumanInputFormRepositoryImpl
from core.workflow.nodes.human_input.entities import (
    DeliveryChannelConfig,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    FormDefinition,
    HumanInputNodeData,
    MemberRecipient,
    UserAction,
    WebAppDeliveryMethod,
)
from core.workflow.repositories.human_input_form_repository import FormCreateParams
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
)


def _create_tenant_with_members(session: Session, member_emails: list[str]) -> tuple[Tenant, list[Account]]:
    tenant = Tenant(name="Test Tenant", status="normal")
    session.add(tenant)
    session.flush()

    members: list[Account] = []
    for index, email in enumerate(member_emails):
        account = Account(
            email=email,
            name=f"Member {index}",
            interface_language="en-US",
            status="active",
        )
        session.add(account)
        session.flush()

        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL,
            current=True,
        )
        session.add(tenant_join)
        members.append(account)

    session.commit()
    return tenant, members


def _build_form_params(delivery_methods: list[DeliveryChannelConfig]) -> FormCreateParams:
    form_config = HumanInputNodeData(
        title="Human Approval",
        delivery_methods=delivery_methods,
        form_content="<p>Approve?</p>",
        user_actions=[UserAction(id="approve", title="Approve")],
    )
    return FormCreateParams(
        app_id=str(uuid4()),
        workflow_execution_id=str(uuid4()),
        node_id="human-input-node",
        form_config=form_config,
        rendered_content="<p>Approve?</p>",
        delivery_methods=delivery_methods,
        display_in_ui=False,
        resolved_default_values={},
    )


def _build_email_delivery(
    whole_workspace: bool, recipients: list[MemberRecipient | ExternalRecipient]
) -> EmailDeliveryMethod:
    return EmailDeliveryMethod(
        config=EmailDeliveryConfig(
            recipients=EmailRecipients(whole_workspace=whole_workspace, items=recipients),
            subject="Approval Needed",
            body="Please review",
        )
    )


class TestHumanInputFormRepositoryImplWithContainers:
    def test_create_form_with_whole_workspace_recipients(self, db_session_with_containers: Session) -> None:
        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        tenant, members = _create_tenant_with_members(
            db_session_with_containers,
            member_emails=["member1@example.com", "member2@example.com"],
        )

        repository = HumanInputFormRepositoryImpl(session_factory=engine, tenant_id=tenant.id)
        params = _build_form_params(
            delivery_methods=[_build_email_delivery(whole_workspace=True, recipients=[])],
        )

        form_entity = repository.create_form(params)

        with Session(engine) as verification_session:
            recipients = verification_session.scalars(
                select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id == form_entity.id)
            ).all()

        assert len(recipients) == len(members)
        member_payloads = [
            EmailMemberRecipientPayload.model_validate_json(recipient.recipient_payload)
            for recipient in recipients
            if recipient.recipient_type == RecipientType.EMAIL_MEMBER
        ]
        member_emails = {payload.email for payload in member_payloads}
        assert member_emails == {member.email for member in members}

    def test_create_form_with_specific_members_and_external(self, db_session_with_containers: Session) -> None:
        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        tenant, members = _create_tenant_with_members(
            db_session_with_containers,
            member_emails=["primary@example.com", "secondary@example.com"],
        )

        repository = HumanInputFormRepositoryImpl(session_factory=engine, tenant_id=tenant.id)
        params = _build_form_params(
            delivery_methods=[
                _build_email_delivery(
                    whole_workspace=False,
                    recipients=[
                        MemberRecipient(user_id=members[0].id),
                        ExternalRecipient(email="external@example.com"),
                    ],
                )
            ],
        )

        form_entity = repository.create_form(params)

        with Session(engine) as verification_session:
            recipients = verification_session.scalars(
                select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id == form_entity.id)
            ).all()

        member_recipient_payloads = [
            EmailMemberRecipientPayload.model_validate_json(recipient.recipient_payload)
            for recipient in recipients
            if recipient.recipient_type == RecipientType.EMAIL_MEMBER
        ]
        assert len(member_recipient_payloads) == 1
        assert member_recipient_payloads[0].user_id == members[0].id

        external_payloads = [
            EmailExternalRecipientPayload.model_validate_json(recipient.recipient_payload)
            for recipient in recipients
            if recipient.recipient_type == RecipientType.EMAIL_EXTERNAL
        ]
        assert len(external_payloads) == 1
        assert external_payloads[0].email == "external@example.com"

    def test_create_form_persists_default_values(self, db_session_with_containers: Session) -> None:
        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        tenant, _ = _create_tenant_with_members(
            db_session_with_containers,
            member_emails=["prefill@example.com"],
        )

        repository = HumanInputFormRepositoryImpl(session_factory=engine, tenant_id=tenant.id)
        resolved_values = {"greeting": "Hello!"}
        params = FormCreateParams(
            app_id=str(uuid4()),
            workflow_execution_id=str(uuid4()),
            node_id="human-input-node",
            form_config=HumanInputNodeData(
                title="Human Approval",
                form_content="<p>Approve?</p>",
                inputs=[],
                user_actions=[UserAction(id="approve", title="Approve")],
            ),
            rendered_content="<p>Approve?</p>",
            delivery_methods=[],
            display_in_ui=False,
            resolved_default_values=resolved_values,
        )

        form_entity = repository.create_form(params)

        with Session(engine) as verification_session:
            form_model = verification_session.scalars(
                select(HumanInputForm).where(HumanInputForm.id == form_entity.id)
            ).first()

        assert form_model is not None
        definition = FormDefinition.model_validate_json(form_model.form_definition)
        assert definition.default_values == resolved_values

    def test_create_form_persists_display_in_ui(self, db_session_with_containers: Session) -> None:
        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        tenant, _ = _create_tenant_with_members(
            db_session_with_containers,
            member_emails=["ui@example.com"],
        )

        repository = HumanInputFormRepositoryImpl(session_factory=engine, tenant_id=tenant.id)
        params = FormCreateParams(
            app_id=str(uuid4()),
            workflow_execution_id=str(uuid4()),
            node_id="human-input-node",
            form_config=HumanInputNodeData(
                title="Human Approval",
                form_content="<p>Approve?</p>",
                inputs=[],
                user_actions=[UserAction(id="approve", title="Approve")],
                delivery_methods=[WebAppDeliveryMethod()],
            ),
            rendered_content="<p>Approve?</p>",
            delivery_methods=[WebAppDeliveryMethod()],
            display_in_ui=True,
            resolved_default_values={},
        )

        form_entity = repository.create_form(params)

        with Session(engine) as verification_session:
            form_model = verification_session.scalars(
                select(HumanInputForm).where(HumanInputForm.id == form_entity.id)
            ).first()

        assert form_model is not None
        definition = FormDefinition.model_validate_json(form_model.form_definition)
        assert definition.display_in_ui is True
