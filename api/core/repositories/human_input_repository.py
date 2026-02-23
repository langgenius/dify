import dataclasses
import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.workflow.nodes.human_input.entities import (
    DeliveryChannelConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    FormDefinition,
    HumanInputNodeData,
    MemberRecipient,
    WebAppDeliveryMethod,
)
from core.workflow.nodes.human_input.enums import (
    DeliveryMethodType,
    HumanInputFormKind,
    HumanInputFormStatus,
)
from core.workflow.repositories.human_input_form_repository import (
    FormCreateParams,
    FormNotFoundError,
    HumanInputFormEntity,
    HumanInputFormRecipientEntity,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, TenantAccountJoin
from models.human_input import (
    BackstageRecipientPayload,
    ConsoleDeliveryPayload,
    ConsoleRecipientPayload,
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
    StandaloneWebAppRecipientPayload,
)


@dataclasses.dataclass(frozen=True)
class _DeliveryAndRecipients:
    delivery: HumanInputDelivery
    recipients: Sequence[HumanInputFormRecipient]


@dataclasses.dataclass(frozen=True)
class _WorkspaceMemberInfo:
    user_id: str
    email: str


class _HumanInputFormRecipientEntityImpl(HumanInputFormRecipientEntity):
    def __init__(self, recipient_model: HumanInputFormRecipient):
        self._recipient_model = recipient_model

    @property
    def id(self) -> str:
        return self._recipient_model.id

    @property
    def token(self) -> str:
        if self._recipient_model.access_token is None:
            raise AssertionError(f"access_token should not be None for recipient {self._recipient_model.id}")
        return self._recipient_model.access_token


class _HumanInputFormEntityImpl(HumanInputFormEntity):
    def __init__(self, form_model: HumanInputForm, recipient_models: Sequence[HumanInputFormRecipient]):
        self._form_model = form_model
        self._recipients = [_HumanInputFormRecipientEntityImpl(recipient) for recipient in recipient_models]
        self._web_app_recipient = next(
            (
                recipient
                for recipient in recipient_models
                if recipient.recipient_type == RecipientType.STANDALONE_WEB_APP
            ),
            None,
        )
        self._console_recipient = next(
            (recipient for recipient in recipient_models if recipient.recipient_type == RecipientType.CONSOLE),
            None,
        )
        self._submitted_data: Mapping[str, Any] | None = (
            json.loads(form_model.submitted_data) if form_model.submitted_data is not None else None
        )

    @property
    def id(self) -> str:
        return self._form_model.id

    @property
    def web_app_token(self):
        if self._console_recipient is not None:
            return self._console_recipient.access_token
        if self._web_app_recipient is None:
            return None
        return self._web_app_recipient.access_token

    @property
    def recipients(self) -> list[HumanInputFormRecipientEntity]:
        return list(self._recipients)

    @property
    def rendered_content(self) -> str:
        return self._form_model.rendered_content

    @property
    def selected_action_id(self) -> str | None:
        return self._form_model.selected_action_id

    @property
    def submitted_data(self) -> Mapping[str, Any] | None:
        return self._submitted_data

    @property
    def submitted(self) -> bool:
        return self._form_model.submitted_at is not None

    @property
    def status(self) -> HumanInputFormStatus:
        return self._form_model.status

    @property
    def expiration_time(self) -> datetime:
        return self._form_model.expiration_time


@dataclasses.dataclass(frozen=True)
class HumanInputFormRecord:
    form_id: str
    workflow_run_id: str | None
    node_id: str
    tenant_id: str
    app_id: str
    form_kind: HumanInputFormKind
    definition: FormDefinition
    rendered_content: str
    created_at: datetime
    expiration_time: datetime
    status: HumanInputFormStatus
    selected_action_id: str | None
    submitted_data: Mapping[str, Any] | None
    submitted_at: datetime | None
    submission_user_id: str | None
    submission_end_user_id: str | None
    completed_by_recipient_id: str | None
    recipient_id: str | None
    recipient_type: RecipientType | None
    access_token: str | None

    @property
    def submitted(self) -> bool:
        return self.submitted_at is not None

    @classmethod
    def from_models(
        cls, form_model: HumanInputForm, recipient_model: HumanInputFormRecipient | None
    ) -> "HumanInputFormRecord":
        definition_payload = json.loads(form_model.form_definition)
        if "expiration_time" not in definition_payload:
            definition_payload["expiration_time"] = form_model.expiration_time
        return cls(
            form_id=form_model.id,
            workflow_run_id=form_model.workflow_run_id,
            node_id=form_model.node_id,
            tenant_id=form_model.tenant_id,
            app_id=form_model.app_id,
            form_kind=form_model.form_kind,
            definition=FormDefinition.model_validate(definition_payload),
            rendered_content=form_model.rendered_content,
            created_at=form_model.created_at,
            expiration_time=form_model.expiration_time,
            status=form_model.status,
            selected_action_id=form_model.selected_action_id,
            submitted_data=json.loads(form_model.submitted_data) if form_model.submitted_data else None,
            submitted_at=form_model.submitted_at,
            submission_user_id=form_model.submission_user_id,
            submission_end_user_id=form_model.submission_end_user_id,
            completed_by_recipient_id=form_model.completed_by_recipient_id,
            recipient_id=recipient_model.id if recipient_model else None,
            recipient_type=recipient_model.recipient_type if recipient_model else None,
            access_token=recipient_model.access_token if recipient_model else None,
        )


class _InvalidTimeoutStatusError(ValueError):
    pass


class HumanInputFormRepositoryImpl:
    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory
        self._tenant_id = tenant_id

    def _delivery_method_to_model(
        self,
        session: Session,
        form_id: str,
        delivery_method: DeliveryChannelConfig,
    ) -> _DeliveryAndRecipients:
        delivery_id = str(uuidv7())
        delivery_model = HumanInputDelivery(
            id=delivery_id,
            form_id=form_id,
            delivery_method_type=delivery_method.type,
            delivery_config_id=delivery_method.id,
            channel_payload=delivery_method.model_dump_json(),
        )
        recipients: list[HumanInputFormRecipient] = []
        if isinstance(delivery_method, WebAppDeliveryMethod):
            recipient_model = HumanInputFormRecipient(
                form_id=form_id,
                delivery_id=delivery_id,
                recipient_type=RecipientType.STANDALONE_WEB_APP,
                recipient_payload=StandaloneWebAppRecipientPayload().model_dump_json(),
            )
            recipients.append(recipient_model)
        elif isinstance(delivery_method, EmailDeliveryMethod):
            email_recipients_config = delivery_method.config.recipients
            recipients.extend(
                self._build_email_recipients(
                    session=session,
                    form_id=form_id,
                    delivery_id=delivery_id,
                    recipients_config=email_recipients_config,
                )
            )

        return _DeliveryAndRecipients(delivery=delivery_model, recipients=recipients)

    def _build_email_recipients(
        self,
        session: Session,
        form_id: str,
        delivery_id: str,
        recipients_config: EmailRecipients,
    ) -> list[HumanInputFormRecipient]:
        member_user_ids = [
            recipient.user_id for recipient in recipients_config.items if isinstance(recipient, MemberRecipient)
        ]
        external_emails = [
            recipient.email for recipient in recipients_config.items if isinstance(recipient, ExternalRecipient)
        ]
        if recipients_config.whole_workspace:
            members = self._query_all_workspace_members(session=session)
        else:
            members = self._query_workspace_members_by_ids(session=session, restrict_to_user_ids=member_user_ids)

        return self._create_email_recipients_from_resolved(
            form_id=form_id,
            delivery_id=delivery_id,
            members=members,
            external_emails=external_emails,
        )

    @staticmethod
    def _create_email_recipients_from_resolved(
        *,
        form_id: str,
        delivery_id: str,
        members: Sequence[_WorkspaceMemberInfo],
        external_emails: Sequence[str],
    ) -> list[HumanInputFormRecipient]:
        recipient_models: list[HumanInputFormRecipient] = []
        seen_emails: set[str] = set()

        for member in members:
            if not member.email:
                continue
            if member.email in seen_emails:
                continue
            seen_emails.add(member.email)
            payload = EmailMemberRecipientPayload(user_id=member.user_id, email=member.email)
            recipient_models.append(
                HumanInputFormRecipient.new(
                    form_id=form_id,
                    delivery_id=delivery_id,
                    payload=payload,
                )
            )

        for email in external_emails:
            if not email:
                continue
            if email in seen_emails:
                continue
            seen_emails.add(email)
            recipient_models.append(
                HumanInputFormRecipient.new(
                    form_id=form_id,
                    delivery_id=delivery_id,
                    payload=EmailExternalRecipientPayload(email=email),
                )
            )

        return recipient_models

    def _query_all_workspace_members(
        self,
        session: Session,
    ) -> list[_WorkspaceMemberInfo]:
        stmt = (
            select(Account.id, Account.email)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == self._tenant_id)
        )
        rows = session.execute(stmt).all()
        return [_WorkspaceMemberInfo(user_id=account_id, email=email) for account_id, email in rows]

    def _query_workspace_members_by_ids(
        self,
        session: Session,
        restrict_to_user_ids: Sequence[str],
    ) -> list[_WorkspaceMemberInfo]:
        unique_ids = {user_id for user_id in restrict_to_user_ids if user_id}
        if not unique_ids:
            return []

        stmt = (
            select(Account.id, Account.email)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == self._tenant_id)
        )
        stmt = stmt.where(Account.id.in_(unique_ids))

        rows = session.execute(stmt).all()
        return [_WorkspaceMemberInfo(user_id=account_id, email=email) for account_id, email in rows]

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        form_config: HumanInputNodeData = params.form_config

        with self._session_factory(expire_on_commit=False) as session, session.begin():
            # Generate unique form ID
            form_id = str(uuidv7())
            start_time = naive_utc_now()
            node_expiration = form_config.expiration_time(start_time)
            form_definition = FormDefinition(
                form_content=form_config.form_content,
                inputs=form_config.inputs,
                user_actions=form_config.user_actions,
                rendered_content=params.rendered_content,
                expiration_time=node_expiration,
                default_values=dict(params.resolved_default_values),
                display_in_ui=params.display_in_ui,
                node_title=form_config.title,
            )
            form_model = HumanInputForm(
                id=form_id,
                tenant_id=self._tenant_id,
                app_id=params.app_id,
                workflow_run_id=params.workflow_execution_id,
                form_kind=params.form_kind,
                node_id=params.node_id,
                form_definition=form_definition.model_dump_json(),
                rendered_content=params.rendered_content,
                expiration_time=node_expiration,
                created_at=start_time,
            )
            session.add(form_model)
            recipient_models: list[HumanInputFormRecipient] = []
            for delivery in params.delivery_methods:
                delivery_and_recipients = self._delivery_method_to_model(
                    session=session,
                    form_id=form_id,
                    delivery_method=delivery,
                )
                session.add(delivery_and_recipients.delivery)
                session.add_all(delivery_and_recipients.recipients)
                recipient_models.extend(delivery_and_recipients.recipients)
            if params.console_recipient_required and not any(
                recipient.recipient_type == RecipientType.CONSOLE for recipient in recipient_models
            ):
                console_delivery_id = str(uuidv7())
                console_delivery = HumanInputDelivery(
                    id=console_delivery_id,
                    form_id=form_id,
                    delivery_method_type=DeliveryMethodType.WEBAPP,
                    delivery_config_id=None,
                    channel_payload=ConsoleDeliveryPayload().model_dump_json(),
                )
                console_recipient = HumanInputFormRecipient(
                    form_id=form_id,
                    delivery_id=console_delivery_id,
                    recipient_type=RecipientType.CONSOLE,
                    recipient_payload=ConsoleRecipientPayload(
                        account_id=params.console_creator_account_id,
                    ).model_dump_json(),
                )
                session.add(console_delivery)
                session.add(console_recipient)
                recipient_models.append(console_recipient)
            if params.backstage_recipient_required and not any(
                recipient.recipient_type == RecipientType.BACKSTAGE for recipient in recipient_models
            ):
                backstage_delivery_id = str(uuidv7())
                backstage_delivery = HumanInputDelivery(
                    id=backstage_delivery_id,
                    form_id=form_id,
                    delivery_method_type=DeliveryMethodType.WEBAPP,
                    delivery_config_id=None,
                    channel_payload=ConsoleDeliveryPayload().model_dump_json(),
                )
                backstage_recipient = HumanInputFormRecipient(
                    form_id=form_id,
                    delivery_id=backstage_delivery_id,
                    recipient_type=RecipientType.BACKSTAGE,
                    recipient_payload=BackstageRecipientPayload(
                        account_id=params.console_creator_account_id,
                    ).model_dump_json(),
                )
                session.add(backstage_delivery)
                session.add(backstage_recipient)
                recipient_models.append(backstage_recipient)
            session.flush()

        return _HumanInputFormEntityImpl(form_model=form_model, recipient_models=recipient_models)

    def get_form(self, workflow_execution_id: str, node_id: str) -> HumanInputFormEntity | None:
        form_query = select(HumanInputForm).where(
            HumanInputForm.workflow_run_id == workflow_execution_id,
            HumanInputForm.node_id == node_id,
            HumanInputForm.tenant_id == self._tenant_id,
        )
        with self._session_factory(expire_on_commit=False) as session:
            form_model: HumanInputForm | None = session.scalars(form_query).first()
            if form_model is None:
                return None

            recipient_query = select(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id == form_model.id)
            recipient_models = session.scalars(recipient_query).all()
        return _HumanInputFormEntityImpl(form_model=form_model, recipient_models=recipient_models)


class HumanInputFormSubmissionRepository:
    """Repository for fetching and submitting human input forms."""

    def __init__(self, session_factory: sessionmaker | Engine):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory

    def get_by_token(self, form_token: str) -> HumanInputFormRecord | None:
        query = (
            select(HumanInputFormRecipient)
            .options(selectinload(HumanInputFormRecipient.form))
            .where(HumanInputFormRecipient.access_token == form_token)
        )
        with self._session_factory(expire_on_commit=False) as session:
            recipient_model = session.scalars(query).first()
            if recipient_model is None or recipient_model.form is None:
                return None
            return HumanInputFormRecord.from_models(recipient_model.form, recipient_model)

    def get_by_form_id_and_recipient_type(
        self,
        form_id: str,
        recipient_type: RecipientType,
    ) -> HumanInputFormRecord | None:
        query = (
            select(HumanInputFormRecipient)
            .options(selectinload(HumanInputFormRecipient.form))
            .where(
                HumanInputFormRecipient.form_id == form_id,
                HumanInputFormRecipient.recipient_type == recipient_type,
            )
        )
        with self._session_factory(expire_on_commit=False) as session:
            recipient_model = session.scalars(query).first()
            if recipient_model is None or recipient_model.form is None:
                return None
            return HumanInputFormRecord.from_models(recipient_model.form, recipient_model)

    def mark_submitted(
        self,
        *,
        form_id: str,
        recipient_id: str | None,
        selected_action_id: str,
        form_data: Mapping[str, Any],
        submission_user_id: str | None,
        submission_end_user_id: str | None,
    ) -> HumanInputFormRecord:
        with self._session_factory(expire_on_commit=False) as session, session.begin():
            form_model = session.get(HumanInputForm, form_id)
            if form_model is None:
                raise FormNotFoundError(f"form not found, id={form_id}")

            recipient_model = session.get(HumanInputFormRecipient, recipient_id) if recipient_id else None

            form_model.selected_action_id = selected_action_id
            form_model.submitted_data = json.dumps(form_data)
            form_model.submitted_at = naive_utc_now()
            form_model.status = HumanInputFormStatus.SUBMITTED
            form_model.submission_user_id = submission_user_id
            form_model.submission_end_user_id = submission_end_user_id
            form_model.completed_by_recipient_id = recipient_id

            session.add(form_model)
            session.flush()
            session.refresh(form_model)
            if recipient_model is not None:
                session.refresh(recipient_model)

            return HumanInputFormRecord.from_models(form_model, recipient_model)

    def mark_timeout(
        self,
        *,
        form_id: str,
        timeout_status: HumanInputFormStatus,
        reason: str | None = None,
    ) -> HumanInputFormRecord:
        with self._session_factory(expire_on_commit=False) as session, session.begin():
            form_model = session.get(HumanInputForm, form_id)
            if form_model is None:
                raise FormNotFoundError(f"form not found, id={form_id}")

            if timeout_status not in {HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED}:
                raise _InvalidTimeoutStatusError(f"invalid timeout status: {timeout_status}")

            # already handled or submitted
            if form_model.status in {HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED}:
                return HumanInputFormRecord.from_models(form_model, None)

            if form_model.submitted_at is not None or form_model.status == HumanInputFormStatus.SUBMITTED:
                raise FormNotFoundError(f"form already submitted, id={form_id}")

            form_model.status = timeout_status
            form_model.selected_action_id = None
            form_model.submitted_data = None
            form_model.submission_user_id = None
            form_model.submission_end_user_id = None
            form_model.completed_by_recipient_id = None
            # Reason is recorded in status/error downstream; not stored on form.
            session.add(form_model)
            session.flush()
            session.refresh(form_model)

            return HumanInputFormRecord.from_models(form_model, None)
