"""Compose Human Input use cases without owning a database transaction."""

from __future__ import annotations

from typing import override

from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.runtime import HumanInputRuntime, PreparedForm
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool

from .delivery_service import HumanInputDeliveryService
from .form_service import HumanInputFormService


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
        """Run the initial delivery round only for this call's CreatedForm result.

        Call form_service.prepare_form once. Return a reused PreparedForm
        immediately; do not check existence separately or infer initialization
        ownership from the number of recipients.

        For CreatedForm, initialization has already committed. Invoke
        delivery_service.deliver once for each persisted recipient, passing the
        detached Form, Recipient, and frozen message template. Do not compare
        recipients' endpoints, select card/link mode, create deliveries, or
        generate tokens here. DeliveryService owns these operations and returns
        committed attempts plus a nullable Current Initiator token. Aggregate
        results across recipients; a partial failure remains a warning.

        After sending, call form_service.get_form for the same node execution:
        an earlier delivery may already have produced an accepted submission.
        Honor the persisted terminal outcome before interpreting skipped sends
        as all-delivery failure. Otherwise, no successful notification and no
        usable initiator surface raises HumanInputDeliveryError for Node.
        Failure does not roll back initialization or completed external sends.
        Do not add a new Form status for delivery failure.

        Return PreparedForm with the refreshed Form and the nullable initiator
        token from delivery results. Never substitute an Email or IM recipient's
        token. Recipient merging is complete before this runtime starts delivery.

        TODO: Specify recovery for a crash after initialization commits but
        before sends finish. Ordinary existing-form reentry must not resend;
        cross-service calls do not provide a distributed transaction.
        """
        raise NotImplementedError
