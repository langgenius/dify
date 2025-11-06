"""
Service for managing human input forms using domain models.

This service layer operates on domain models and uses repositories for persistence,
keeping the business logic clean and independent of database concerns.
"""

import logging
from typing import Any, Optional

from core.workflow.entities.human_input_form import HumanInputForm, HumanInputFormStatus, HumanInputSubmissionType
from core.workflow.repositories.human_input_form_repository import HumanInputFormRepository
from services.errors.base import BaseServiceError

logger = logging.getLogger(__name__)


class HumanInputFormNotFoundError(BaseServiceError):
    """Raised when a human input form is not found."""

    def __init__(self, identifier: str):
        super().__init__(f"Human input form not found: {identifier}")
        self.identifier = identifier


class HumanInputFormExpiredError(BaseServiceError):
    """Raised when a human input form has expired."""

    def __init__(self):
        super().__init__("Human input form has expired")


class HumanInputFormAlreadySubmittedError(BaseServiceError):
    """Raised when trying to operate on an already submitted form."""

    def __init__(self):
        super().__init__("Human input form has already been submitted")


class InvalidFormDataError(BaseServiceError):
    """Raised when form submission data is invalid."""

    def __init__(self, message: str):
        super().__init__(f"Invalid form data: {message}")
        self.message = message


class HumanInputFormDomainService:
    """Service for managing human input forms using domain models."""

    def __init__(self, repository: HumanInputFormRepository):
        """
        Initialize the service with a repository.

        Args:
            repository: Repository for human input form persistence
        """
        self._repository = repository

    def create_form(
        self,
        *,
        form_id: str,
        workflow_run_id: str,
        form_definition: dict[str, Any],
        rendered_content: str,
        web_app_token: Optional[str] = None,
    ) -> HumanInputForm:
        """
        Create a new human input form.

        Args:
            form_id: Unique identifier for the form
            workflow_run_id: ID of the associated workflow run
            form_definition: Form definition as a dictionary
            rendered_content: Rendered HTML content of the form
            web_app_token: Optional token for web app access

        Returns:
            Created HumanInputForm domain model
        """
        form = HumanInputForm.create(
            id_=form_id,
            workflow_run_id=workflow_run_id,
            form_definition=form_definition,
            rendered_content=rendered_content,
            web_app_token=web_app_token,
        )

        self._repository.save(form)
        logger.info("Created human input form %s", form_id)
        return form

    def get_form_by_id(self, form_id: str) -> HumanInputForm:
        """
        Get a form by its ID.

        Args:
            form_id: The ID of the form to retrieve

        Returns:
            HumanInputForm domain model

        Raises:
            HumanInputFormNotFoundError: If the form is not found
        """
        try:
            return self._repository.get_by_id(form_id)
        except ValueError as e:
            raise HumanInputFormNotFoundError(form_id) from e

    def get_form_by_token(self, web_app_token: str) -> HumanInputForm:
        """
        Get a form by its web app token.

        Args:
            web_app_token: The web app token to search for

        Returns:
            HumanInputForm domain model

        Raises:
            HumanInputFormNotFoundError: If the form is not found
        """
        try:
            return self._repository.get_by_web_app_token(web_app_token)
        except ValueError as e:
            raise HumanInputFormNotFoundError(web_app_token) from e

    def get_form_definition(
        self,
        identifier: str,
        is_token: bool = False,
        include_site_info: bool = False,
        app_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Get form definition for display.

        Args:
            identifier: Form ID or web app token
            is_token: True if identifier is a web app token, False if it's a form ID
            include_site_info: Whether to include site information in the response
            app_id: App ID for site information (if include_site_info is True)

        Returns:
            Form definition dictionary for display

        Raises:
            HumanInputFormNotFoundError: If the form is not found
            HumanInputFormExpiredError: If the form has expired
            HumanInputFormAlreadySubmittedError: If the form has already been submitted
        """
        if is_token:
            form = self.get_form_by_token(identifier)
        else:
            form = self.get_form_by_id(identifier)

        try:
            form_definition = form.get_form_definition_for_display(include_site_info=include_site_info)
        except ValueError as e:
            if "expired" in str(e).lower():
                raise HumanInputFormExpiredError() from e
            elif "submitted" in str(e).lower():
                raise HumanInputFormAlreadySubmittedError() from e
            else:
                raise InvalidFormDataError(str(e)) from e

        # Add site info if requested and app_id is provided
        if include_site_info and app_id and "site" in form_definition:
            form_definition["site"]["app_id"] = app_id

        return form_definition

    def submit_form(
        self,
        identifier: str,
        form_data: dict[str, Any],
        action: str,
        is_token: bool = False,
        submission_type: HumanInputSubmissionType = HumanInputSubmissionType.web_form,
        submission_user_id: Optional[str] = None,
        submission_end_user_id: Optional[str] = None,
    ) -> HumanInputForm:
        """
        Submit a form.

        Args:
            identifier: Form ID or web app token
            form_data: The submitted form data
            action: The action taken by the user
            is_token: True if identifier is a web app token, False if it's a form ID
            submission_type: Type of submission (web_form, web_app, email)
            submission_user_id: ID of the user who submitted (for console submissions)
            submission_end_user_id: ID of the end user who submitted (for webapp submissions)

        Returns:
            Updated HumanInputForm domain model

        Raises:
            HumanInputFormNotFoundError: If the form is not found
            HumanInputFormExpiredError: If the form has expired
            HumanInputFormAlreadySubmittedError: If the form has already been submitted
            InvalidFormDataError: If the submission data is invalid
        """
        if is_token:
            form = self.get_form_by_token(identifier)
        else:
            form = self.get_form_by_id(identifier)

        if form.is_expired:
            raise HumanInputFormExpiredError()

        if form.is_submitted:
            raise HumanInputFormAlreadySubmittedError()

        try:
            form.submit(
                data=form_data,
                action=action,
                submission_type=submission_type,
                submission_user_id=submission_user_id,
                submission_end_user_id=submission_end_user_id,
            )
        except ValueError as e:
            raise InvalidFormDataError(str(e)) from e

        self._repository.save(form)
        logger.info("Form %s submitted with action %s", form.id_, action)
        return form

    def cleanup_expired_forms(self, expiry_hours: int = 48) -> int:
        """
        Clean up expired forms.

        Args:
            expiry_hours: Number of hours after which forms should be expired

        Returns:
            Number of forms cleaned up
        """
        count = self._repository.mark_expired_forms(expiry_hours)
        logger.info("Cleaned up %d expired forms", count)
        return count

    def get_pending_forms_for_workflow_run(self, workflow_run_id: str) -> list[HumanInputForm]:
        """
        Get all pending human input forms for a workflow run.

        Args:
            workflow_run_id: The workflow run ID to filter by

        Returns:
            List of pending HumanInputForm domain models
        """
        return self._repository.get_pending_forms_for_workflow_run(workflow_run_id)

    def form_exists(self, identifier: str, is_token: bool = False) -> bool:
        """
        Check if a form exists.

        Args:
            identifier: Form ID or web app token
            is_token: True if identifier is a web app token, False if it's a form ID

        Returns:
            True if the form exists, False otherwise
        """
        if is_token:
            return self._repository.exists_by_web_app_token(identifier)
        else:
            return self._repository.exists_by_id(identifier)
