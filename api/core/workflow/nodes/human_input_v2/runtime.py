"""The Human Input operation needed by a workflow node."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from pydantic import SecretStr

from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from repositories.human_input_v2.form_repository import Form

from .entities import HumanInputNodeData


@dataclass(frozen=True, slots=True)
class PreparedForm:
    """An existing or newly delivered form and its initiator stream token.

    form_token belongs only to the Current Initiator delivery selected by this
    node's recipient configuration. It is None without that configuration or
    without a usable, verified initiator. Never substitute another recipient's
    token. The token locates the form; submission still requires authentication.
    """

    form: Form
    form_token: SecretStr | None = field(repr=False)


class HumanInputDeliveryError(Exception):
    """No delivery succeeded; the node must emit failed execution, not pause."""


class HumanInputRuntime(Protocol):
    """Run-bound approval lifecycle composing transaction-owning services.

    The composition boundary binds tenant, app, workflow run, authenticated
    initiator, and debugging identity. The node supplies only execution-local
    facts. Recipient resolution, channels, transactions, notification execution,
    and delivery-result aggregation remain behind this interface.
    Its implementation owns no transaction; each service commits its own work
    before the runtime invokes the next service.

    Form is the existing detached snapshot, not a repository capability. Reuse
    its persisted status and typed submission. PreparedForm adds only the stream
    token that Form does not contain; it does not define another state machine.
    """

    def prepare_form(
        self,
        *,
        node_execution_id: str,
        node_data: HumanInputNodeData,
        variable_pool: ReadOnlyVariablePool,
    ) -> PreparedForm:
        """Initialize or revisit the approval for this exact node execution.

        Look up the form first. If it exists, return its frozen content, status,
        submission, and initiator token without creating or sending anything.
        In particular, an unfilled form does not trigger another delivery round.

        Otherwise create Form and resolved/merged Recipients in one transaction.
        After commit, deliver independently to each Recipient; shared endpoints
        across different recipients do not suppress a delivery. Determine and
        persist each recipient's deliveries before provider I/O. Perform
        delivery and record each actual result within this node invocation;
        do not return success merely because deliveries were created or queued.

        Raise HumanInputDeliveryError if every delivery failed or no approval
        path exists. A usable Current Initiator interaction surface counts as
        a delivery path without an external provider call. Partial failures are
        warnings when another delivery succeeded. Return after aggregating the
        results. Delivery success leaves the form waiting for human input.

        Only Current Initiator configuration permits a stream form_token; Email
        and IM deliveries never supply the token for Workflow/Chatflow streams.
        Preserve this rule on reentry using the original recipient grant.

        Expiration handling is separate from this lookup/create operation.
        Persisted TIMEOUT selects the timeout branch; EXPIRED belongs to
        whole-workflow termination. Do not recompute terminal outcomes here.
        """
        ...
