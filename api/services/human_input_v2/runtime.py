"""Compose Human Input use cases without owning a database transaction."""

from __future__ import annotations

import logging
from typing import override

from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.runtime import HumanInputDeliveryError, HumanInputRuntime, PreparedForm
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from repositories.human_input_v2.delivery_attempt_repository import DeliveryStatus

from .delivery_service import HumanInputDeliveryService
from .form_service import HumanInputFormService

logger = logging.getLogger(__name__)


class DifyHumanInputRuntime(HumanInputRuntime):
    """Combine committed initialization, delivery, and delivery-result handling.

    Services own their transactions and construct their own repositories. This
    runtime neither opens a Session nor commits, rolls back, or shares one
    service's transaction with another service.
    """

    def __init__(
        self,
        *,
        form_service: HumanInputFormService,
        delivery_service: HumanInputDeliveryService,
    ) -> None:
        self._form_service = form_service
        self._delivery_service = delivery_service

    @override
    def prepare_form(
        self,
        *,
        node_execution_id: str,
        node_data: HumanInputNodeData,
        variable_pool: ReadOnlyVariablePool,
    ) -> PreparedForm:
        """Send notifications on first initialization, then prepare to pause.

        Existing forms are read without repeating notifications, including when
        initialization or delivery was interrupted. Reentry only recovers the
        persisted form and its existing Current Initiator entry.

        Only Current Initiator deliveries provide a stream token. Submission
        requires a persisted workflow pause, so the initial delivery round does
        not refresh the form before requesting that pause.
        Partial failure does not discard successful deliveries; total failure
        still fails the node without rolling back external sends.
        """
        initialization = self._form_service.prepare_form(
            node_execution_id=node_execution_id,
            node_data=node_data,
            variable_pool=variable_pool,
        )
        if isinstance(initialization, PreparedForm):
            return initialization
        has_successful_delivery = False
        form_token = None
        for recipient in initialization.recipients:
            result = self._delivery_service.deliver(
                form=initialization.form,
                recipient=recipient,
                message_template=initialization.message_template,
                debug_channels=initialization.debug_channels,
            )
            if result.form_token is not None:
                form_token = result.form_token
            for attempt in result.attempts:
                if attempt.status == DeliveryStatus.SUCCEEDED:
                    has_successful_delivery = True
                else:
                    logger.warning(
                        "Human Input delivery failed: form_id=%s recipient_id=%s delivery_id=%s attempt_id=%s",
                        initialization.form.id,
                        recipient.id,
                        attempt.delivery_id,
                        attempt.id,
                    )
        if not has_successful_delivery and form_token is None:
            raise HumanInputDeliveryError("No one can approve this step.")
        return PreparedForm(form=initialization.form, form_token=form_token)
