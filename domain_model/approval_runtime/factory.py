"""Application-facing creation contract for a complete Human Input task."""

from datetime import datetime
from typing import Protocol

from domain_model.approval_runtime.model import FormInstance
from domain_model.configuration.model import FormConfiguration
from domain_model.recipient_resolution.model import (
    ContactResolutionPort,
    InitiatorResolutionPort,
    VariableResolutionPort,
)
from domain_model.shared.identifiers import FormInstanceId, WorkspaceId


class FormInstanceFactory(Protocol):
    """Creation boundary that hides recipient-resolution implementation details.

    Implementations are used once per runtime task. They consume the recipient
    specifications embedded in ``FormConfiguration``, resolve current runtime
    identities, freeze the existing approver-grant and endpoint persistence records,
    and return a complete WAITING ``FormInstance``. The intermediate
    ``ResolvedRecipients`` value must not escape as an execution plan.
    """

    def create(
        self,
        *,
        instance_id: FormInstanceId,
        workspace_id: WorkspaceId,
        configuration: FormConfiguration,
        contacts: ContactResolutionPort,
        variables: VariableResolutionPort,
        initiator: InitiatorResolutionPort,
        created_at: datetime,
        debug_run: bool,
    ) -> FormInstance:
        """Resolve recipients and atomically create one complete runtime task."""

        ...
