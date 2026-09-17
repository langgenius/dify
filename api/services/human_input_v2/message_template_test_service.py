"""Render a saved draft template and send it only to its authenticated editor."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, JsonValue, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.helper import encrypter
from core.human_input_v2.entities import DebugChannel
from core.human_input_v2.im_integration.adapters.entities import MessageSendingError, ProviderUserId
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared.values import AccountId, TenantId
from core.workflow.human_input_adapter import EmailDeliveryConfig
from core.workflow.nodes.human_input_v2.entities import MessageTemplateConfig
from graphon.runtime import VariablePool
from graphon.variables.template_resolution import VARIABLE_PATTERN, convert_template
from models.workflow import NodeNotFoundError, Workflow, WorkflowDataError
from repositories.human_input_v2.email_channel.entities import ResendCandidate
from repositories.human_input_v2.email_channel.ports import (
    EmailChannelRepository,
    EmailProviderOperationError,
    EmailProviderValidationError,
)
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelReader
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.im_credential_codec import IMCredentialError
from services.human_input_v2.resend_channel import ResendProviderGateway

# Template tests never issue an approval grant or create a submittable form.
_TEST_REQUEST_URL = "https://example.com/human-input-test"


class MessageTemplateTestError(Exception):
    """A safe, actionable error returned to the editor without sending."""


class MessageTemplateSendError(MessageTemplateTestError):
    """The selected provider did not confirm acceptance of the test message."""


class _TemplateNode(BaseModel):
    type: Literal["human-input"]
    version: Literal["2"]
    message_template: MessageTemplateConfig


@dataclass(frozen=True, slots=True)
class _RenderedTemplate:
    subject: str = field(repr=False)
    body: str = field(repr=False)


class MessageTemplateTestService:
    def __init__(
        self,
        *,
        session_factory: Callable[[], Session],
        tenant_id: TenantId,
        account_id: AccountId,
        account_email: str,
        email_repository: EmailChannelRepository,
        email_gateway: ResendProviderGateway,
        im_adapter_factory: Callable[[IMChannel], IMProviderAdapter],
    ) -> None:
        self._sessions = session_factory
        self._tenant_id = tenant_id
        self._account_id = account_id
        self._account_email = account_email
        self._email_repository = email_repository
        self._email_gateway = email_gateway
        self._im_adapter_factory = im_adapter_factory

    def send_test(
        self,
        *,
        app_id: str,
        node_id: str,
        channel: DebugChannel,
        inputs: Mapping[str, JsonValue],
    ) -> None:
        template = self._render(app_id, node_id, inputs)
        if channel is DebugChannel.EMAIL:
            self._send_email(template)
            return

        im_channel, provider_user_id = self._load_im_destination(channel)
        try:
            adapter = self._im_adapter_factory(im_channel)
        except IMCredentialError:
            raise MessageTemplateTestError("The selected IM channel's credentials are unavailable.") from None
        try:
            result = adapter.messaging.send_text(provider_user_id, f"{template.subject}\n\n{template.body}")
            if isinstance(result, MessageSendingError):
                raise MessageTemplateSendError("The IM provider did not accept the test message.")
        finally:
            adapter.close()

    def _render(self, app_id: str, node_id: str, inputs: Mapping[str, JsonValue]) -> _RenderedTemplate:
        with self._sessions() as session:
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.tenant_id == str(self._tenant_id),
                    Workflow.app_id == app_id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
            )
            if workflow is None:
                raise MessageTemplateTestError("Workflow draft was not found.")
            try:
                node_config = workflow.get_node_config_by_id(node_id)
                node = _TemplateNode.model_validate(node_config["data"].model_dump())
            except (NodeNotFoundError, WorkflowDataError, ValidationError):
                raise MessageTemplateTestError(
                    "A Human Input v2 node with a valid message template is required."
                ) from None
            pool = VariablePool.from_bootstrap(environment_variables=workflow.environment_variables)

        template = node.message_template
        for match in VARIABLE_PATTERN.finditer(f"{template.subject}\n{template.body}"):
            reference = match.group(1)
            selector = reference.split(".")
            # Environment values come from the saved workflow, never request overrides.
            if selector[0] != "env":
                key = f"#{reference}#"
                if key not in inputs:
                    raise MessageTemplateTestError(f"A test value is required for {reference}.")
                pool.add(selector, inputs[key])
            if pool.get(selector) is None:
                raise MessageTemplateTestError(f"The template variable {reference} is unavailable.")

        # Substitute the reserved URL before variables so input values remain literal.
        subject = convert_template(pool, template.subject.replace("{{#url#}}", _TEST_REQUEST_URL)).text
        body = convert_template(pool, template.body.replace("{{#url#}}", _TEST_REQUEST_URL)).text
        subject = EmailDeliveryConfig.sanitize_subject(subject)
        if not subject.strip() or not body.strip():
            raise MessageTemplateTestError("Message subject and body must not be blank.")
        return _RenderedTemplate(subject, body)

    def _send_email(self, template: _RenderedTemplate) -> None:
        html = EmailDeliveryConfig.render_markdown_body(template.body)
        if not html.strip():
            raise MessageTemplateTestError("The rendered email body must not be blank.")
        configuration = self._email_repository.load(self._tenant_id)
        if configuration is None:
            raise MessageTemplateTestError("An Email channel must be configured in this workspace.")
        if not self._account_email:
            raise MessageTemplateTestError("The current editor has no email address.")
        candidate = ResendCandidate(
            sender_email=configuration.sender_email,
            sender_name=configuration.sender_name,
            api_key=encrypter.decrypt_token(str(self._tenant_id), configuration.protected_api_key),
        )
        try:
            self._email_gateway.send_message(
                candidate,
                to=self._account_email,
                subject=template.subject,
                html=html,
            )
        except (EmailProviderOperationError, EmailProviderValidationError):
            raise MessageTemplateSendError("The Email provider did not accept the test message.") from None

    def _load_im_destination(self, channel: DebugChannel) -> tuple[IMChannel, ProviderUserId]:
        with self._sessions() as session:
            im_channel = WorkspaceIMChannelReader(session, self._tenant_id).get()
            if im_channel is None or im_channel.provider.value != channel.value:
                raise MessageTemplateTestError("The selected IM channel is not configured in this workspace.")
            contact = SQLAlchemyContactRepository(session).get_contact_by_account_id(self._tenant_id, self._account_id)
            if contact is None:
                raise MessageTemplateTestError("The current editor has no available Contact in this workspace.")
            binding = SQLAlchemyIMBindingRepository(session, im_channel.id).get_effective(self._tenant_id, contact.id)
            if binding is None:
                raise MessageTemplateTestError("The current editor has no binding for the selected IM channel.")
            identity = SQLAlchemyIMIdentityRepository(session, im_channel.id).get(binding.identity_id)
            if identity is None:
                raise MessageTemplateTestError("The current editor's IM identity is no longer available.")
            return im_channel, ProviderUserId(identity.provider_user_id)
