import dataclasses
import json
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker, selectinload

from core.workflow.nodes.human_input.entities import (
    DeliveryChannelConfig,
    EmailDeliveryMethod,
    EmailRecipient,
    ExternalRecipient,
    FormDefinition,
    HumanInputNodeData,
    MemberRecipient,
    WebAppDeliveryMethod,
)
from core.workflow.repositories.human_input_form_repository import (
    FormCreateParams,
    FormNotFoundError,
    FormSubmission,
    HumanInputFormEntity,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, TenantAccountJoin
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    RecipientType,
    WebAppRecipientPayload,
)


@dataclasses.dataclass(frozen=True)
class _DeliveryAndRecipients:
    delivery: HumanInputDelivery
    recipients: Sequence[HumanInputFormRecipient]

    def webapp_recipient(self) -> HumanInputFormRecipient | None:
        return next((i for i in self.recipients if i.recipient_type == RecipientType.WEBAPP), None)


@dataclasses.dataclass(frozen=True)
class _WorkspaceMemberInfo:
    user_id: str
    email: str


class _HumanInputFormEntityImpl(HumanInputFormEntity):
    def __init__(self, form_model: HumanInputForm, web_app_recipient: HumanInputFormRecipient | None):
        self._form_model = form_model
        self._web_app_recipient = web_app_recipient

    @property
    def id(self) -> str:
        return self._form_model.id

    @property
    def web_app_token(self):
        if self._web_app_recipient is None:
            return None
        return self._web_app_recipient.access_token


class _FormSubmissionImpl(FormSubmission):
    def __init__(self, form_model: HumanInputForm):
        self._form_model = form_model

    @property
    def selected_action_id(self) -> str:
        selected_action_id = self._form_model.selected_action_id
        if selected_action_id is None:
            raise AssertionError(f"selected_action_id should not be None, form_id={self._form_model.id}")
        return selected_action_id

    def form_data(self) -> Mapping[str, Any]:
        submitted_data = self._form_model.submitted_data
        if submitted_data is None:
            raise AssertionError(f"submitted_data should not be None, form_id={self._form_model.id}")
        return json.loads(submitted_data)


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
                recipient_type=RecipientType.WEBAPP,
                recipient_payload=WebAppRecipientPayload().model_dump_json(),
            )
            recipients.append(recipient_model)
        elif isinstance(delivery_method, EmailDeliveryMethod):
            email_recipients_config = delivery_method.config.recipients
            if email_recipients_config.whole_workspace:
                recipients.extend(
                    self._create_whole_workspace_recipients(
                        session=session,
                        form_id=form_id,
                        delivery_id=delivery_id,
                    )
                )
            else:
                recipients.extend(
                    self._create_email_recipients(
                        session=session,
                        form_id=form_id,
                        delivery_id=delivery_id,
                        recipients=email_recipients_config.items,
                    )
                )

        return _DeliveryAndRecipients(delivery=delivery_model, recipients=recipients)

    def _create_email_recipients(
        self,
        session: Session,
        form_id: str,
        delivery_id: str,
        recipients: Sequence[EmailRecipient],
    ) -> list[HumanInputFormRecipient]:
        recipient_models: list[HumanInputFormRecipient] = []
        member_user_ids: list[str] = []
        for r in recipients:
            if isinstance(r, MemberRecipient):
                member_user_ids.append(r.user_id)
            elif isinstance(r, ExternalRecipient):
                recipient_model = HumanInputFormRecipient.new(
                    form_id=form_id, delivery_id=delivery_id, payload=EmailExternalRecipientPayload(email=r.email)
                )
                recipient_models.append(recipient_model)
            else:
                raise AssertionError(f"unknown recipient type: recipient={r}")

        member_entries = {
            member.user_id: member.email
            for member in self._query_workspace_members(session=session, user_ids=member_user_ids)
        }
        for user_id in member_user_ids:
            email = member_entries.get(user_id)
            if email is None:
                continue
            payload = EmailMemberRecipientPayload(user_id=user_id, email=email)
            recipient_model = HumanInputFormRecipient.new(
                form_id=form_id,
                delivery_id=delivery_id,
                payload=payload,
            )
            recipient_models.append(recipient_model)
        return recipient_models

    def _create_whole_workspace_recipients(
        self,
        session: Session,
        form_id: str,
        delivery_id: str,
    ) -> list[HumanInputFormRecipient]:
        recipeint_models = []
        members = self._query_workspace_members(session=session, user_ids=None)
        for member in members:
            payload = EmailMemberRecipientPayload(user_id=member.user_id, email=member.email)
            recipient_model = HumanInputFormRecipient.new(
                form_id=form_id,
                delivery_id=delivery_id,
                payload=payload,
            )
            recipeint_models.append(recipient_model)

        return recipeint_models

    def _query_workspace_members(
        self,
        session: Session,
        user_ids: Sequence[str] | None,
    ) -> list[_WorkspaceMemberInfo]:
        unique_ids: set[str] | None
        if user_ids is None:
            unique_ids = None
        else:
            unique_ids = {user_id for user_id in user_ids if user_id}
            if not unique_ids:
                return []

        stmt = (
            select(Account.id, Account.email)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == self._tenant_id)
        )
        if unique_ids is not None:
            stmt = stmt.where(Account.id.in_(unique_ids))

        rows = session.execute(stmt).all()
        return [_WorkspaceMemberInfo(user_id=account_id, email=email) for account_id, email in rows]

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        form_config: HumanInputNodeData = params.form_config

        with self._session_factory(expire_on_commit=False) as session, session.begin():
            # Generate unique form ID
            form_id = str(uuidv7())
            form_definition = FormDefinition(
                form_content=form_config.form_content,
                inputs=form_config.inputs,
                user_actions=form_config.user_actions,
                rendered_content=params.rendered_content,
                timeout=form_config.timeout,
                timeout_unit=form_config.timeout_unit,
            )
            form_model = HumanInputForm(
                id=form_id,
                tenant_id=self._tenant_id,
                workflow_run_id=params.workflow_execution_id,
                node_id=params.node_id,
                form_definition=form_definition.model_dump_json(),
                rendered_content=params.rendered_content,
                expiration_time=form_config.expiration_time(naive_utc_now()),
            )
            session.add(form_model)
            web_app_recipient: HumanInputFormRecipient | None = None
            for delivery in form_config.delivery_methods:
                delivery_and_recipients = self._delivery_method_to_model(
                    session=session,
                    form_id=form_id,
                    delivery_method=delivery,
                )
                session.add(delivery_and_recipients.delivery)
                session.add_all(delivery_and_recipients.recipients)
                if web_app_recipient is None:
                    web_app_recipient = delivery_and_recipients.webapp_recipient()
            session.flush()

        return _HumanInputFormEntityImpl(form_model=form_model, web_app_recipient=web_app_recipient)

    def get_form_submission(self, workflow_execution_id: str, node_id: str) -> FormSubmission | None:
        query = select(HumanInputForm).where(
            HumanInputForm.workflow_run_id == workflow_execution_id,
            HumanInputForm.node_id == node_id,
        )
        with self._session_factory(expire_on_commit=False) as session:
            form_model: HumanInputForm | None = session.scalars(query).first()
            if form_model is None:
                raise FormNotFoundError(f"form not found for node, {workflow_execution_id=}, {node_id=}")

            if form_model.submitted_at is None:
                return None

        return _FormSubmissionImpl(form_model=form_model)

    def get_form_by_token(self, token: str, recipient_type: RecipientType | None = None):
        query = (
            select(HumanInputFormRecipient)
            .options(selectinload(HumanInputFormRecipient.form))
            .where()

        with self._session_factory(expire_on_commit=False) as session:
            form_recipient = session.qu
