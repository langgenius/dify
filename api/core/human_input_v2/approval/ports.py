"""Operation-oriented persistence ports for the Human Input v2 form boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2 import ResolvedForm
from core.human_input_v2.entities import HumanInputV2FormStatus
from core.human_input_v2.shared import TenantId

from .delivery import (
    DeliveryAttempt,
    DeliveryEndpoint,
    ProtectedRenderedEmailRequest,
    UploadCapability,
    UploadFileAssociation,
)
from .form import FormCreation, HumanInputForm
from .grants import ApproverGrant, DeliveryEndpointRef, FormRef


@dataclass(frozen=True, slots=True)
class FormDefinitionProjection:
    """Read model for rendering a form through one endpoint capability."""

    form_ref: FormRef
    endpoint_ref: DeliveryEndpointRef
    resolved_form: ResolvedForm
    display_in_ui: bool | None
    status: HumanInputV2FormStatus
    node_timeout_at: NaiveDatetime
    global_expires_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class FormDeliveryProjection:
    """Read model containing only data needed to deliver one endpoint."""

    form_ref: FormRef
    grant: ApproverGrant
    endpoint: DeliveryEndpoint
    resolved_form: ResolvedForm


class FormRepository(Protocol):
    """Deep adapter contract whose operations own their query and transaction shape."""

    def create_form(self, creation: FormCreation) -> HumanInputForm:
        """Persist form, grants, endpoints, and initial attempts atomically."""

        ...

    def load_for_lifecycle(self, form_ref: FormRef) -> HumanInputForm | None:
        """Load the form and grants required for local transition decisions."""

        ...

    def load_delivery_projection(self, endpoint_ref: DeliveryEndpointRef) -> FormDeliveryProjection | None:
        """Load exactly one endpoint with its grant and form delivery values."""

        ...

    def load_definition_by_endpoint_token(
        self,
        *,
        tenant_id: TenantId,
        token_hash: str,
    ) -> FormDefinitionProjection | None:
        """Resolve a scoped interaction capability without creating authority."""

        ...

    def append_delivery_attempt(self, attempt: DeliveryAttempt) -> DeliveryAttempt:
        """Append one delivery fact without changing form lifecycle status."""

        ...

    def create_upload_capability(self, capability: UploadCapability) -> UploadCapability:
        """Persist one endpoint-scoped upload capability."""

        ...

    def associate_upload_file(self, association: UploadFileAssociation) -> UploadFileAssociation:
        """Associate a file only after validating the full capability owner chain."""

        ...


class RenderedEmailRequestProtector(Protocol):
    """Protect provider-ready content before it enters durable storage."""

    def protect(self, tenant_id: TenantId, serialized_request: str) -> ProtectedRenderedEmailRequest: ...

    def reveal(self, tenant_id: TenantId, protected: ProtectedRenderedEmailRequest) -> str: ...
