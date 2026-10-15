"""Fan out post-submission updates and replace each exact delivered IM card."""

import logging
from collections.abc import Callable
from contextlib import closing

from kombu.exceptions import OperationalError
from sqlalchemy.orm import Session

from configs import dify_config
from core.human_input_v2.im_integration.adapters import factory as im_adapter_factory_module
from core.human_input_v2.im_integration.adapters.entities import ReplacementErrorKind, StaticCardIntent
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.resolved_form import MarkdownFragment
from core.human_input_v2.shared.values import TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from enums import DeploymentEdition
from extensions.ext_key_provider import key_provider_manager
from repositories.human_input_v2.delivery_repository import IMMessageType, IMUserTargetSnapshot
from repositories.human_input_v2.form_repository import Form
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import (
    DeploymentIMChannelReader,
    WorkspaceIMChannelReader,
)
from services.human_input_v2.im_credential_codec import IMCredentialCodec, IMCredentialError
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher

logger = logging.getLogger(__name__)


class IMCardUpdateRetryableError(Exception):
    """A card replacement needs another independent follow-up attempt."""


class HumanInputIMCardService:
    def __init__(self, *, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def enqueue_updates(self, form: Form) -> None:
        from tasks.human_input_im_card_tasks import update_human_input_im_card_task

        with self._session_factory() as session:
            deliveries = SQLAlchemyDeliveryRepository(session).list_deliveries(
                tenant_id=form.tenant_id, form_id=form.id
            )
        for delivery in deliveries:
            target = delivery.target_snapshot
            if (
                not isinstance(target, IMUserTargetSnapshot)
                or target.message_type != IMMessageType.CARD
                or target.message_locator is None
            ):
                continue
            try:
                update_human_input_im_card_task.apply_async(
                    kwargs={"tenant_id": str(form.tenant_id), "form_id": form.id, "delivery_id": delivery.id}
                )
            except OperationalError:
                # One unavailable publication must not suppress other deliveries
                # or prevent the already accepted workflow from resuming.
                logger.exception(
                    "Failed to enqueue Human Input IM card update tenant_id=%s form_id=%s delivery_id=%s",
                    form.tenant_id,
                    form.id,
                    delivery.id,
                )

    def update_card(self, *, tenant_id: TenantId, form_id: str, delivery_id: str) -> None:
        with self._session_factory() as session:
            repository = SQLAlchemyFormRepository.for_existing_form(session, tenant_id=tenant_id, form_id=form_id)
            if repository is None:
                return
            form = repository.get_form_by_id(form_id)
            if form is None or form.status != HumanInputFormStatus.SUBMITTED:
                return
            delivery = SQLAlchemyDeliveryRepository(session).get_delivery(
                tenant_id=tenant_id, form_id=form_id, delivery_id=delivery_id
            )
            if delivery is None:
                return
            target = delivery.target_snapshot
            if (
                not isinstance(target, IMUserTargetSnapshot)
                or target.message_type != IMMessageType.CARD
                or target.message_locator is None
            ):
                return
            channel = (
                DeploymentIMChannelReader(session).get()
                if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE
                else WorkspaceIMChannelReader(session, tenant_id).get()
            )
        if (
            channel is None
            or channel.provider != target.im_provider
            or channel.provider_tenant_id != target.im_tenant_id
        ):
            logger.warning(
                "Human Input IM card channel unavailable tenant_id=%s form_id=%s delivery_id=%s",
                tenant_id,
                form_id,
                delivery_id,
            )
            return

        intent = _submitted_card_intent(form)
        with closing(self._build_adapter(tenant_id, channel)) as adapter:
            cards = adapter.dynamic_card_messaging
            if cards is None:
                return
            # Replacing the same exact card with the committed presentation
            # is idempotent across task retries and broker redelivery.
            failure = cards.replace_with_static(target.message_locator, intent)
            if failure is None:
                logger.info(
                    "Human Input IM card updated tenant_id=%s form_id=%s delivery_id=%s",
                    tenant_id,
                    form_id,
                    delivery_id,
                )
                return
            logger.warning(
                "Human Input IM card update failed tenant_id=%s form_id=%s delivery_id=%s kind=%s",
                tenant_id,
                form_id,
                delivery_id,
                failure.kind,
            )
            if failure.kind == ReplacementErrorKind.UNKNOWN:
                raise IMCardUpdateRetryableError(f"Human Input IM card update failed delivery_id={delivery_id}")

    def _build_adapter(self, tenant_id: TenantId, channel: IMChannel) -> IMProviderAdapter:
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
            # Deployment credentials must never be decrypted with a workspace key.
            raise IMCredentialError("Deployment IM credentials are unavailable")
        cipher = TenantBoundCredentialCipher(key_provider_manager.provider, str(tenant_id))
        credentials = IMCredentialCodec(cipher).load(channel.provider, channel.encrypted_credentials)
        return im_adapter_factory_module.build_im_provider_adapter(credentials)


def _submitted_card_intent(form: Form) -> StaticCardIntent:
    submission = form.submission
    assert submission is not None, "A submitted form must retain its accepted submission"
    fragments: list[str] = []
    for part in form.resolved_form.parts:
        if isinstance(part, MarkdownFragment):
            fragments.append(part.text)
            continue
        # Render source-ordered parts once; submitted output markers are text.
        segment = submission.normalized_submission_data[part.output_variable_name]
        fragments.append(segment.text)
    action = next(action for action in form.resolved_form.actions if action.id == submission.selected_action_id)
    sections = [form.resolved_form.title, "".join(fragments), f"Submitted: {action.title}"]
    return StaticCardIntent("\n\n".join(section for section in sections if section))
