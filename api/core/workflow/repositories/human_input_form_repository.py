import abc
import dataclasses
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Protocol

from core.workflow.nodes.human_input.entities import DeliveryChannelConfig, HumanInputNodeData
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus


class HumanInputError(Exception):
    pass


class FormNotFoundError(HumanInputError):
    pass


@dataclasses.dataclass
class FormCreateParams:
    # app_id is the identifier for the app that the form belongs to.
    # It is a string with uuid format.
    app_id: str
    # None when creating a delivery test form; set for runtime forms.
    workflow_execution_id: str | None

    # node_id is the identifier for a specific
    # node in the graph.
    #
    # TODO: for node inside loop / iteration, this would
    # cause problems, as a single node may be executed multiple times.
    node_id: str

    form_config: HumanInputNodeData
    rendered_content: str
    # Delivery methods already filtered by runtime context (invoke_from).
    delivery_methods: Sequence[DeliveryChannelConfig]
    # UI display flag computed by runtime context.
    display_in_ui: bool

    # resolved_default_values saves the values for defaults with
    # type = VARIABLE.
    #
    # For type = CONSTANT, the value is not stored inside `resolved_default_values`
    resolved_default_values: Mapping[str, Any]
    form_kind: HumanInputFormKind = HumanInputFormKind.RUNTIME

    # Force creating a console-only recipient for submission in Console.
    console_recipient_required: bool = False
    console_creator_account_id: str | None = None
    # Force creating a backstage recipient for submission in Console.
    backstage_recipient_required: bool = False


class HumanInputFormEntity(abc.ABC):
    @property
    @abc.abstractmethod
    def id(self) -> str:
        """id returns the identifer of the form."""
        pass

    @property
    @abc.abstractmethod
    def web_app_token(self) -> str | None:
        """web_app_token returns the token for submission inside webapp.

        For console/debug execution, this may point to the console submission token
        if the form is configured to require console delivery.
        """

        # TODO: what if the users are allowed to add multiple
        # webapp delivery?
        pass

    @property
    @abc.abstractmethod
    def recipients(self) -> list["HumanInputFormRecipientEntity"]: ...

    @property
    @abc.abstractmethod
    def rendered_content(self) -> str:
        """Rendered markdown content associated with the form."""
        ...

    @property
    @abc.abstractmethod
    def selected_action_id(self) -> str | None:
        """Identifier of the selected user action if the form has been submitted."""
        ...

    @property
    @abc.abstractmethod
    def submitted_data(self) -> Mapping[str, Any] | None:
        """Submitted form data if available."""
        ...

    @property
    @abc.abstractmethod
    def submitted(self) -> bool:
        """Whether the form has been submitted."""
        ...

    @property
    @abc.abstractmethod
    def status(self) -> HumanInputFormStatus:
        """Current status of the form."""
        ...

    @property
    @abc.abstractmethod
    def expiration_time(self) -> datetime:
        """When the form expires."""
        ...


class HumanInputFormRecipientEntity(abc.ABC):
    @property
    @abc.abstractmethod
    def id(self) -> str:
        """id returns the identifer of this recipient."""
        ...

    @property
    @abc.abstractmethod
    def token(self) -> str:
        """token returns a random string used to submit form"""
        ...


class HumanInputFormRepository(Protocol):
    """
    Repository interface for HumanInputForm.

    This interface defines the contract for accessing and manipulating
    HumanInputForm data, regardless of the underlying storage mechanism.

    Note: Domain-specific concepts like multi-tenancy (tenant_id), application context (app_id),
    and other implementation details should be handled at the implementation level, not in
    the core interface. This keeps the core domain model clean and independent of specific
    application domains or deployment scenarios.
    """

    def get_form(self, workflow_execution_id: str, node_id: str) -> HumanInputFormEntity | None:
        """Get the form created for a given human input node in a workflow execution. Returns
        `None` if the form has not been created yet."""
        ...

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        """
        Create a human input form from form definition.
        """
        ...
