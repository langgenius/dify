import abc
import dataclasses
import json
import uuid
from collections.abc import Sequence
from typing import Any, Mapping

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

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
    FormSubmissionEntity,
    HumanInputFormEntity,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input import (
    EmailExternalRecipientPayload,
    EmailMemberRecipientPayload,
    HumanInputDelivery,
    HumanInputForm,
    HumanInputRecipient,
    RecipientType,
    WebAppRecipientPayload,
)


@dataclasses.dataclass(frozen=True)
class _DeliveryAndRecipients:
    delivery: HumanInputDelivery
    recipients: Sequence[HumanInputRecipient]

    def webapp_recipient(self) -> HumanInputRecipient | None:
        return next((i for i in self.recipients if i.recipient_type == RecipientType.WEBAPP), None)


class _HumanInputFormEntityImpl(HumanInputFormEntity):
    def __init__(self, form_model: HumanInputForm, web_app_recipient: HumanInputRecipient | None):
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


class _FormSubmissionEntityImpl(FormSubmissionEntity):
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


class WorkspaceMember:
    def user_id(self) -> str:
        pass

    def email(self) -> str:
        pass


class WorkspaceMemberQueirer:
    def get_all_workspace_members(self) -> Sequence[WorkspaceMember]:
        # TOOD: need a way to query all members in the current workspace.
        pass

    def get_members_by_ids(self, user_ids: Sequence[str]) -> Sequence[WorkspaceMember]:
        pass


class HumanInputFormRepositoryImpl:
    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
        member_quierer: WorkspaceMemberQueirer,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory
        self._tenant_id = tenant_id
        self._member_queirer = member_quierer

    def _delivery_method_to_model(self, form_id, delivery_method: DeliveryChannelConfig) -> _DeliveryAndRecipients:
        delivery_id = str(uuidv7())
        delivery_model = HumanInputDelivery(
            id=delivery_id,
            form_id=form_id,
            delivery_method_type=delivery_method.type,
            delivery_config_id=delivery_method.id,
            channel_payload=delivery_method.model_dump_json(),
        )
        recipients: list[HumanInputRecipient] = []
        if isinstance(delivery_method, WebAppDeliveryMethod):
            recipient_model = HumanInputRecipient(
                form_id=form_id,
                delivery_id=delivery_id,
                recipient_type=RecipientType.WEBAPP,
                recipient_payload=WebAppRecipientPayload().model_dump_json(),
            )
            recipients.append(recipient_model)
        elif isinstance(delivery_method, EmailDeliveryMethod):
            email_recipients_config = delivery_method.config.recipients
            if email_recipients_config.whole_workspace:
                recipients.extend(self._create_whole_workspace_recipients(form_id=form_id, delivery_id=delivery_id))
            else:
                recipients.extend(
                    self._create_email_recipients(
                        form_id=form_id, delivery_id=delivery_id, recipients=email_recipients_config.items
                    )
                )

        return _DeliveryAndRecipients(delivery=delivery_model, recipients=recipients)

    def _create_email_recipients(
        self,
        form_id: str,
        delivery_id: str,
        recipients: Sequence[EmailRecipient],
    ) -> list[HumanInputRecipient]:
        recipient_models: list[HumanInputRecipient] = []
        member_user_ids: list[str] = []
        for r in recipients:
            if isinstance(r, MemberRecipient):
                member_user_ids.append(r.user_id)
            elif isinstance(r, ExternalRecipient):
                recipient_model = HumanInputRecipient.new(
                    form_id=form_id, delivery_id=delivery_id, payload=EmailExternalRecipientPayload(email=r.email)
                )
                recipient_models.append(recipient_model)
            else:
                raise AssertionError(f"unknown recipient type: recipient={r}")

        members = self._member_queirer.get_members_by_ids(member_user_ids)
        for member in members:
            payload = EmailMemberRecipientPayload(user_id=member.user_id(), email=member.email())
            recipient_model = HumanInputRecipient.new(
                form_id=form_id,
                delivery_id=delivery_id,
                payload=payload,
            )
            recipient_models.append(recipient_model)
        return recipient_models

    def _create_whole_workspace_recipients(self, form_id: str, delivery_id: str) -> list[HumanInputRecipient]:
        recipeint_models = []
        members = self._member_queirer.get_all_workspace_members()
        for member in members:
            payload = EmailMemberRecipientPayload(user_id=member.user_id(), email=member.email())
            recipient_model = HumanInputRecipient.new(
                form_id=form_id,
                delivery_id=delivery_id,
                payload=payload,
            )
            recipeint_models.append(recipient_model)

        return recipeint_models

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        form_config: HumanInputNodeData = params.form_config

        with self._session_factory(expire_on_commit=False) as session, session.begin():
            # Generate unique form ID
            form_id = str(uuidv7())
            form_definition = FormDefinition(
                inputs=form_config.inputs,
                user_actions=form_config.user_actions,
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
            web_app_recipient: HumanInputRecipient | None = None
            for delivery in form_config.delivery_methods:
                delivery_and_recipients = self._delivery_method_to_model(form_id, delivery)
                session.add(delivery_and_recipients.delivery)
                session.add_all(delivery_and_recipients.recipients)
                if web_app_recipient is None:
                    web_app_recipient = delivery_and_recipients.webapp_recipient()
            session.flush()

        return _HumanInputFormEntityImpl(form_model=form_model, web_app_recipient=web_app_recipient)

    def get_form_submission(self, workflow_execution_id: str, node_id: str) -> FormSubmissionEntity | None:
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

        return _FormSubmissionEntityImpl(form_model=form_model)
