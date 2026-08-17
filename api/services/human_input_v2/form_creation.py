"""Authoritative Human Input v2 form creation and notification handoff."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import override

from pydantic import NaiveDatetime

from core.human_input_v2 import ResolvedForm
from core.human_input_v2.approval import (
    FormRef,
    FormSnapshotIdentifierFactory,
    HumanInputForm,
    ResolvedApprovalPlan,
)
from core.human_input_v2.entities import HumanInputV2FormKind
from core.human_input_v2.shared import (
    AppId,
    ApproverGrantId,
    DeliveryEndpointId,
    TenantId,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .delivery_publisher import DeliveryPublicationResult, HumanInputV2DueAttemptPublisher
from .notification_producer import HumanInputV2NotificationProducer, ProducedHumanInputV2Form


class DefaultFormSnapshotIdentifierFactory(FormSnapshotIdentifierFactory):
    @override
    def new_grant_id(self) -> ApproverGrantId:
        return ApproverGrantId(str(uuidv7()))

    @override
    def new_endpoint_id(self) -> DeliveryEndpointId:
        return DeliveryEndpointId(str(uuidv7()))


@dataclass(frozen=True, slots=True)
class HumanInputV2FormCreationRequest:
    form_ref: FormRef
    app_id: AppId
    resolved_form: ResolvedForm
    display_in_ui: bool | None
    node_timeout_at: NaiveDatetime
    global_expires_at: NaiveDatetime
    kind: HumanInputV2FormKind
    workflow_pause_id: str | None
    node_execution_id: str | None
    plan: ResolvedApprovalPlan
    subject_template: str
    body_template: str


@dataclass(frozen=True, slots=True)
class HumanInputV2FormCreationResult:
    produced: ProducedHumanInputV2Form
    publication: DeliveryPublicationResult


class HumanInputV2FormCreationService:
    """Make the producer unavoidable for notification-bearing v2 form creation."""

    def __init__(
        self,
        producer: HumanInputV2NotificationProducer,
        publisher: HumanInputV2DueAttemptPublisher,
        *,
        identifier_factory: FormSnapshotIdentifierFactory | None = None,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
    ) -> None:
        self._producer = producer
        self._publisher = publisher
        self._identifier_factory = identifier_factory or DefaultFormSnapshotIdentifierFactory()
        self._clock = clock

    def create(
        self,
        request: HumanInputV2FormCreationRequest,
        *,
        render_template: Callable[[str], str],
        build_form_url: Callable[[TenantId, str], str],
    ) -> HumanInputV2FormCreationResult:
        creation = HumanInputForm.create_from_plan(
            ref=request.form_ref,
            app_id=request.app_id,
            resolved_form=request.resolved_form,
            display_in_ui=request.display_in_ui,
            node_timeout_at=request.node_timeout_at,
            global_expires_at=request.global_expires_at,
            kind=request.kind,
            workflow_pause_id=request.workflow_pause_id,
            node_execution_id=request.node_execution_id,
            plan=request.plan,
            identifier_factory=self._identifier_factory,
            now=self._clock(),
        )
        produced = self._producer.create(
            creation,
            subject_template=request.subject_template,
            body_template=request.body_template,
            render_template=render_template,
            build_form_url=build_form_url,
        )
        return HumanInputV2FormCreationResult(produced, self._publisher.publish_due())


__all__ = [
    "DefaultFormSnapshotIdentifierFactory",
    "HumanInputV2FormCreationRequest",
    "HumanInputV2FormCreationResult",
    "HumanInputV2FormCreationService",
]
