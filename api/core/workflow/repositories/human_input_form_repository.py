from typing import Protocol

from core.workflow.entities.human_input_form import HumanInputForm


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

    def save(self, form: HumanInputForm) -> None:
        """
        Save or update a HumanInputForm instance.

        This method handles both creating new records and updating existing ones.
        The implementation should determine whether to create or update based on
        the form's ID or other identifying fields.

        Args:
            form: The HumanInputForm instance to save or update
        """
        ...

    def get_by_id(self, form_id: str) -> HumanInputForm:
        """
        Get a form by its ID.

        Args:
            form_id: The ID of the form to retrieve

        Returns:
            The HumanInputForm instance

        Raises:
            NotFoundError: If the form is not found
        """
        ...

    def get_by_web_app_token(self, web_app_token: str) -> HumanInputForm:
        """
        Get a form by its web app token.

        Args:
            web_app_token: The web app token to search for

        Returns:
            The HumanInputForm instance

        Raises:
            NotFoundError: If the form is not found
        """
        ...

    def get_pending_forms_for_workflow_run(self, workflow_run_id: str) -> list[HumanInputForm]:
        """
        Get all pending human input forms for a workflow run.

        Args:
            workflow_run_id: The workflow run ID to filter by

        Returns:
            List of pending HumanInputForm instances
        """
        ...

    def mark_expired_forms(self, expiry_hours: int = 48) -> int:
        """
        Mark expired forms as expired.

        Args:
            expiry_hours: Number of hours after which forms should be expired

        Returns:
            Number of forms marked as expired
        """
        ...

    def exists_by_id(self, form_id: str) -> bool:
        """
        Check if a form exists by ID.

        Args:
            form_id: The ID of the form to check

        Returns:
            True if the form exists, False otherwise
        """
        ...

    def exists_by_web_app_token(self, web_app_token: str) -> bool:
        """
        Check if a form exists by web app token.

        Args:
            web_app_token: The web app token to check

        Returns:
            True if the form exists, False otherwise
        """
        ...
