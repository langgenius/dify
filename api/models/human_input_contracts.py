"""Form persistence ports consumed by Human Input execution and application services."""

import dataclasses
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Protocol

from enums.human_input import HumanInputFormKind, HumanInputFormStatus, RecipientType
from models.human_input_delivery import DeliveryChannelConfig
from models.human_input_entities import FormDefinition, HumanInputNodeData


class FormNotFoundError(Exception):
    pass


@dataclasses.dataclass
class FormCreateParams:
    workflow_execution_id: str | None
    node_id: str
    form_config: HumanInputNodeData
    rendered_content: str
    delivery_methods: Sequence[DeliveryChannelConfig]
    display_in_ui: bool
    resolved_default_values: Mapping[str, Any]
    form_kind: HumanInputFormKind = HumanInputFormKind.RUNTIME
    # ENG-635: the conversation this form belongs to. Set together with
    # workflow_execution_id for chatflow runs; set alone (workflow_execution_id None)
    # for Agent v2 chat ask_human forms, which have no workflow run.
    conversation_id: str | None = None
    form_id: str | None = None


class HumanInputFormRecipientEntity(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def token(self) -> str: ...


class HumanInputFormEntity(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def recipients(self) -> list[HumanInputFormRecipientEntity]: ...

    @property
    def rendered_content(self) -> str: ...

    @property
    def selected_action_id(self) -> str | None: ...

    @property
    def created_at(self) -> datetime: ...

    @property
    def submitted_data(self) -> Mapping[str, Any] | None: ...

    @property
    def submitted(self) -> bool: ...

    @property
    def status(self) -> HumanInputFormStatus: ...

    @property
    def expiration_time(self) -> datetime: ...


class HumanInputFormRepository(Protocol):
    def get_form(self, node_id: str, *, form_id: str | None = None) -> HumanInputFormEntity | None: ...

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity: ...


@dataclasses.dataclass(frozen=True)
class HumanInputFormRecord:
    form_id: str
    workflow_run_id: str | None
    node_id: str
    tenant_id: str
    app_id: str
    form_kind: HumanInputFormKind
    definition: FormDefinition
    rendered_content: str
    created_at: datetime
    expiration_time: datetime
    status: HumanInputFormStatus
    selected_action_id: str | None
    submitted_data: Mapping[str, Any] | None
    submitted_at: datetime | None
    submission_user_id: str | None
    submission_end_user_id: str | None
    completed_by_recipient_id: str | None
    recipient_id: str | None
    recipient_type: RecipientType | None
    access_token: str | None
    # ENG-635: Agent v2 chat owner (NULL for workflow-owned forms). Trailing +
    # defaulted so existing record constructions stay source-compatible.
    conversation_id: str | None = None

    @property
    def submitted(self) -> bool:
        return self.submitted_at is not None


class HumanInputFormRecordView(Protocol):
    """Read-only submission state consumed by the Human Input application service."""

    @property
    def form_id(self) -> str: ...

    @property
    def workflow_run_id(self) -> str | None: ...

    @property
    def conversation_id(self) -> str | None: ...

    @property
    def tenant_id(self) -> str: ...

    @property
    def app_id(self) -> str: ...

    @property
    def form_kind(self) -> HumanInputFormKind: ...

    @property
    def definition(self) -> FormDefinition: ...

    @property
    def created_at(self) -> datetime: ...

    @property
    def expiration_time(self) -> datetime: ...

    @property
    def status(self) -> HumanInputFormStatus: ...

    @property
    def recipient_id(self) -> str | None: ...

    @property
    def recipient_type(self) -> RecipientType | None: ...

    @property
    def submitted(self) -> bool: ...


class HumanInputFormSubmissionStore(Protocol):
    """Persistence port shared by legacy and session-bound Human Input repositories."""

    def get_by_token(self, form_token: str) -> HumanInputFormRecordView | None: ...

    def mark_submitted(
        self,
        *,
        form_id: str,
        recipient_id: str | None,
        selected_action_id: str,
        form_data: Mapping[str, Any],
        submission_user_id: str | None,
        submission_end_user_id: str | None,
    ) -> HumanInputFormRecordView: ...


@dataclasses.dataclass(frozen=True)
class PauseFormSnapshot:
    id: str
    expiration_time: datetime
    form_definition: str
    recipients: Sequence[tuple[RecipientType, str]]


class HumanInputFormFactory(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_execution_id: str | None,
        invoke_source: str,
        submission_actor_id: str | None,
    ) -> HumanInputFormRepository: ...
