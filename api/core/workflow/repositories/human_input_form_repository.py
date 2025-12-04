import abc
import dataclasses
from collections.abc import Mapping
from typing import Any, Protocol

from core.workflow.nodes.human_input.entities import HumanInputNodeData


class HumanInputError(Exception):
    pass


class FormNotFoundError(HumanInputError):
    pass


@dataclasses.dataclass
class FormCreateParams:
    workflow_execution_id: str

    # node_id is the identifier for a specific
    # node in the graph.
    #
    # TODO: for node inside loop / iteration, this would
    # cause problems, as a single node may be executed multiple times.
    node_id: str

    form_config: HumanInputNodeData
    rendered_content: str

    # resolved_placeholder_values saves the values for placeholders with
    # type = VARIABLE.
    #
    # For type = CONSTANT, the value is not stored inside `resolved_placeholder_values`
    resolved_placeholder_values: Mapping[str, Any]


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

        If web app delivery is not enabled, this method would return `None`.
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


class FormSubmission(abc.ABC):
    @property
    @abc.abstractmethod
    def selected_action_id(self) -> str:
        """The identifier of action user has selected, correspond to `UserAction.id`."""
        pass

    @abc.abstractmethod
    def form_data(self) -> Mapping[str, Any]:
        """The data submitted for this form"""
        pass


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

    def get_form_submission(self, form_id: str) -> FormSubmission | None:
        """Retrieve the submission for a specific human input node.

        Returns `FormSubmission` if the form has been submitted, or `None` if not.

        Raises `FormNotFoundError` if correspond form record is not found.
        """
        ...
