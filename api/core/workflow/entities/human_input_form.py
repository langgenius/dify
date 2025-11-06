"""
Domain entities for human input forms.

Models are independent of the storage mechanism and don't contain
implementation details like tenant_id, app_id, etc.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field

from libs.datetime_utils import naive_utc_now


def naive_utc_from_now() -> datetime:
    """Get current UTC datetime."""
    return naive_utc_now()


class HumanInputFormStatus(StrEnum):
    """Status of a human input form."""

    WAITING = "waiting"
    EXPIRED = "expired"
    SUBMITTED = "submitted"
    TIMEOUT = "timeout"


class HumanInputSubmissionType(StrEnum):
    """Type of submission for human input forms."""

    web_form = "web_form"
    web_app = "web_app"
    email = "email"


class FormSubmission(BaseModel):
    """Represents a form submission."""

    data: dict[str, Any] = Field(default_factory=dict)
    action: str = ""
    submitted_at: datetime = Field(default_factory=naive_utc_now)
    submission_type: HumanInputSubmissionType = HumanInputSubmissionType.web_form
    submission_user_id: Optional[str] = None
    submission_end_user_id: Optional[str] = None
    submitter_email: Optional[str] = None


class HumanInputForm(BaseModel):
    """
    Domain model for human input forms.

    This model represents the business concept of a human input form without
    infrastructure concerns like tenant_id, app_id, etc.
    """

    id_: str = Field(...)
    workflow_run_id: str = Field(...)
    form_definition: dict[str, Any] = Field(default_factory=dict)
    rendered_content: str = ""
    status: HumanInputFormStatus = HumanInputFormStatus.WAITING
    web_app_token: Optional[str] = None
    submission: Optional[FormSubmission] = None
    created_at: datetime = Field(default_factory=naive_utc_from_now)

    @property
    def is_submitted(self) -> bool:
        """Check if the form has been submitted."""
        return self.status == HumanInputFormStatus.SUBMITTED

    @property
    def is_expired(self) -> bool:
        """Check if the form has expired."""
        return self.status == HumanInputFormStatus.EXPIRED

    @property
    def is_waiting(self) -> bool:
        """Check if the form is waiting for submission."""
        return self.status == HumanInputFormStatus.WAITING

    @property
    def can_be_submitted(self) -> bool:
        """Check if the form can still be submitted."""
        return self.status == HumanInputFormStatus.WAITING

    def submit(
        self,
        data: dict[str, Any],
        action: str,
        submission_type: HumanInputSubmissionType = HumanInputSubmissionType.web_form,
        submission_user_id: Optional[str] = None,
        submission_end_user_id: Optional[str] = None,
        submitter_email: Optional[str] = None,
    ) -> None:
        """
        Submit the form with the given data and action.

        Args:
            data: The form data submitted by the user
            action: The action taken by the user
            submission_type: Type of submission
            submission_user_id: ID of the user who submitted (console submissions)
            submission_end_user_id: ID of the end user who submitted (webapp submissions)
            submitter_email: Email of the submitter (if applicable)

        Raises:
            ValueError: If the form cannot be submitted
        """
        if not self.can_be_submitted:
            raise ValueError(f"Form cannot be submitted in status: {self.status}")

        # Validate that the action is valid based on form definition
        valid_actions = {act.get("id") for act in self.form_definition.get("user_actions", [])}
        if action not in valid_actions:
            raise ValueError(f"Invalid action: {action}")

        self.submission = FormSubmission(
            data=data,
            action=action,
            submission_type=submission_type,
            submission_user_id=submission_user_id,
            submission_end_user_id=submission_end_user_id,
            submitter_email=submitter_email,
        )
        self.status = HumanInputFormStatus.SUBMITTED

    def expire(self) -> None:
        """Mark the form as expired."""
        if self.status != HumanInputFormStatus.WAITING:
            raise ValueError(f"Form cannot be expired in status: {self.status}")

        self.status = HumanInputFormStatus.EXPIRED

    def get_form_definition_for_display(self, include_site_info: bool = False) -> dict[str, Any]:
        """
        Get form definition for display purposes.

        Args:
            include_site_info: Whether to include site information in the response

        Returns:
            Form definition dictionary for display
        """
        if self.status == HumanInputFormStatus.EXPIRED:
            raise ValueError("Form has expired")

        if self.status == HumanInputFormStatus.SUBMITTED:
            raise ValueError("Form has already been submitted")

        response = {
            "form_content": self.rendered_content,
            "inputs": self.form_definition.get("inputs", []),
            "user_actions": self.form_definition.get("user_actions", []),
        }

        if include_site_info:
            # Note: In domain model, we don't have app_id
            # This would be added at the application layer
            response["site"] = {
                "title": "Workflow Form",
            }

        return response

    @classmethod
    def create(
        cls,
        *,
        id_: str,
        workflow_run_id: str,
        form_definition: dict[str, Any],
        rendered_content: str,
        web_app_token: Optional[str] = None,
    ) -> "HumanInputForm":
        """
        Create a new human input form.

        Args:
            id_: Unique identifier for the form
            workflow_run_id: ID of the associated workflow run
            form_definition: Form definition as a dictionary
            rendered_content: Rendered HTML content of the form
            web_app_token: Optional token for web app access

        Returns:
            New HumanInputForm instance
        """
        return cls(
            id_=id_,
            workflow_run_id=workflow_run_id,
            form_definition=form_definition,
            rendered_content=rendered_content,
            status=HumanInputFormStatus.WAITING,
            web_app_token=web_app_token,
        )
