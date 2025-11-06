"""
Service for managing human input forms.

This service maintains backward compatibility while internally using domain models
and repositories for better architecture.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from core.repositories.factory import DifyCoreRepositoryFactory
from core.workflow.entities.human_input_form import HumanInputForm as DomainHumanInputForm, HumanInputSubmissionType
from core.workflow.repositories.human_input_form_repository import HumanInputFormRepository
from models.human_input import (
    HumanInputForm,
    HumanInputFormStatus,
    HumanInputSubmissionType as DBHumanInputSubmissionType,
)
from services.errors.base import BaseServiceError
from services.human_input_form_domain_service import (
    HumanInputFormDomainService,
    HumanInputFormNotFoundError as DomainNotFoundError,
    HumanInputFormExpiredError as DomainExpiredError,
    HumanInputFormAlreadySubmittedError as DomainAlreadySubmittedError,
    InvalidFormDataError as DomainInvalidFormDataError,
)

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


class HumanInputFormService:
    """Service for managing human input forms using domain models internally."""

    def __init__(self, session: Session):
        """
        Initialize the service with a database session.

        Args:
            session: SQLAlchemy session
        """
        self._session = session
        # For backward compatibility, we need user and app_id context
        # These would typically be available from the request context
        # For now, we'll extract them from the session or use defaults
        self._user = None  # This should be set from request context
        self._app_id = None  # This should be set from request context
        self._domain_service = None

    def _get_domain_service(self) -> HumanInputFormDomainService:
        """
        Get the domain service instance.

        Note: This requires user and app_id context to be properly set.
        In a real implementation, these would be extracted from the request context.
        """
        if self._domain_service is None:
            if not self._user:
                # For backward compatibility, we need to handle this case
                # In practice, the user should be available from the request context
                raise ValueError("User context is required for domain operations")

            repository = DifyCoreRepositoryFactory.create_human_input_form_repository(
                session_factory=self._session,
                user=self._user,
                app_id=self._app_id or "",
            )
            self._domain_service = HumanInputFormDomainService(repository)

        return self._domain_service

    def _domain_to_db_model(self, domain_form: DomainHumanInputForm) -> HumanInputForm:
        """Convert domain model to database model for backward compatibility."""
        # Find existing DB model or create new one
        db_model = self._session.get(HumanInputForm, domain_form.id_)
        if db_model is None:
            db_model = HumanInputForm()
            db_model.id = domain_form.id_
            # Set tenant_id and app_id from context
            if hasattr(self._user, "current_tenant_id"):
                db_model.tenant_id = self._user.current_tenant_id
            elif hasattr(self._user, "tenant_id"):
                db_model.tenant_id = self._user.tenant_id
            if self._app_id:
                db_model.app_id = self._app_id

        # Update fields
        db_model.workflow_run_id = domain_form.workflow_run_id
        db_model.form_definition = json.dumps(domain_form.form_definition)
        db_model.rendered_content = domain_form.rendered_content
        db_model.status = HumanInputFormStatus(domain_form.status.value)
        db_model.web_app_token = domain_form.web_app_token
        db_model.created_at = domain_form.created_at

        # Handle submission data
        if domain_form.submission:
            db_model.submitted_data = json.dumps(domain_form.submission.data)
            db_model.submitted_at = domain_form.submission.submitted_at
            db_model.submission_type = DBHumanInputSubmissionType(domain_form.submission.submission_type.value)
            db_model.submission_user_id = domain_form.submission.submission_user_id
            db_model.submission_end_user_id = domain_form.submission.submission_end_user_id
            # Note: submitter_email is not in the current DB model schema

        return db_model

    def set_context(self, user, app_id: Optional[str] = None) -> None:
        """
        Set user and app context for the service.

        Args:
            user: User object (Account or EndUser)
            app_id: Application ID
        """
        self._user = user
        self._app_id = app_id
        self._domain_service = None  # Reset to force recreation with new context

    def create_form(
        self,
        *,
        form_id: str,
        workflow_run_id: str,
        tenant_id: str,
        app_id: str,
        form_definition: str,
        rendered_content: str,
        web_app_token: Optional[str] = None,
    ) -> HumanInputForm:
        """Create a new human input form."""
        # Set context for this operation
        self._app_id = app_id

        try:
            domain_service = self._get_domain_service()
            domain_form = domain_service.create_form(
                form_id=form_id,
                workflow_run_id=workflow_run_id,
                form_definition=json.loads(form_definition),
                rendered_content=rendered_content,
                web_app_token=web_app_token,
            )

            # Convert back to DB model for backward compatibility
            db_model = self._domain_to_db_model(domain_form)
            self._session.add(db_model)
            self._session.commit()

            logger.info("Created human input form %s", form_id)
            return db_model

        except (DomainNotFoundError, DomainExpiredError, DomainAlreadySubmittedError, DomainInvalidFormDataError) as e:
            # Convert domain exceptions to service exceptions
            if isinstance(e, DomainNotFoundError):
                raise HumanInputFormNotFoundError(e.identifier) from e
            elif isinstance(e, DomainExpiredError):
                raise HumanInputFormExpiredError() from e
            elif isinstance(e, DomainAlreadySubmittedError):
                raise HumanInputFormAlreadySubmittedError() from e
            elif isinstance(e, DomainInvalidFormDataError):
                raise InvalidFormDataError(e.message) from e

    def get_form_by_id(self, form_id: str) -> HumanInputForm:
        """Get a form by its ID."""
        try:
            domain_service = self._get_domain_service()
            domain_form = domain_service.get_form_by_id(form_id)
            return self._domain_to_db_model(domain_form)
        except (DomainNotFoundError, DomainExpiredError, DomainAlreadySubmittedError, DomainInvalidFormDataError) as e:
            if isinstance(e, DomainNotFoundError):
                raise HumanInputFormNotFoundError(e.identifier) from e
            elif isinstance(e, DomainExpiredError):
                raise HumanInputFormExpiredError() from e
            elif isinstance(e, DomainAlreadySubmittedError):
                raise HumanInputFormAlreadySubmittedError() from e
            elif isinstance(e, DomainInvalidFormDataError):
                raise InvalidFormDataError(e.message) from e

    def get_form_by_token(self, web_app_token: str) -> HumanInputForm:
        """Get a form by its web app token."""
        try:
            domain_service = self._get_domain_service()
            domain_form = domain_service.get_form_by_token(web_app_token)
            return self._domain_to_db_model(domain_form)
        except (DomainNotFoundError, DomainExpiredError, DomainAlreadySubmittedError, DomainInvalidFormDataError) as e:
            if isinstance(e, DomainNotFoundError):
                raise HumanInputFormNotFoundError(e.identifier) from e
            elif isinstance(e, DomainExpiredError):
                raise HumanInputFormExpiredError() from e
            elif isinstance(e, DomainAlreadySubmittedError):
                raise HumanInputFormAlreadySubmittedError() from e
            elif isinstance(e, DomainInvalidFormDataError):
                raise InvalidFormDataError(e.message) from e

    def get_form_definition(
        self,
        identifier: str,
        is_token: bool = False,
        include_site_info: bool = False,
    ) -> dict[str, Any]:
        """
        Get form definition for display.

        Args:
            identifier: Form ID or web app token
            is_token: True if identifier is a web app token, False if it's a form ID
            include_site_info: Whether to include site information in the response
        """
        try:
            domain_service = self._get_domain_service()
            return domain_service.get_form_definition(
                identifier=identifier,
                is_token=is_token,
                include_site_info=include_site_info,
                app_id=self._app_id,
            )
        except (DomainNotFoundError, DomainExpiredError, DomainAlreadySubmittedError, DomainInvalidFormDataError) as e:
            if isinstance(e, DomainNotFoundError):
                raise HumanInputFormNotFoundError(e.identifier) from e
            elif isinstance(e, DomainExpiredError):
                raise HumanInputFormExpiredError() from e
            elif isinstance(e, DomainAlreadySubmittedError):
                raise HumanInputFormAlreadySubmittedError() from e
            elif isinstance(e, DomainInvalidFormDataError):
                raise InvalidFormDataError(e.message) from e

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
        """
        try:
            domain_service = self._get_domain_service()
            domain_form = domain_service.submit_form(
                identifier=identifier,
                form_data=form_data,
                action=action,
                is_token=is_token,
                submission_type=submission_type,
                submission_user_id=submission_user_id,
                submission_end_user_id=submission_end_user_id,
            )

            # Convert back to DB model for backward compatibility
            db_model = self._domain_to_db_model(domain_form)
            self._session.merge(db_model)
            self._session.commit()

            return db_model

        except (DomainNotFoundError, DomainExpiredError, DomainAlreadySubmittedError, DomainInvalidFormDataError) as e:
            if isinstance(e, DomainNotFoundError):
                raise HumanInputFormNotFoundError(e.identifier) from e
            elif isinstance(e, DomainExpiredError):
                raise HumanInputFormExpiredError() from e
            elif isinstance(e, DomainAlreadySubmittedError):
                raise HumanInputFormAlreadySubmittedError() from e
            elif isinstance(e, DomainInvalidFormDataError):
                raise InvalidFormDataError(e.message) from e

    def _validate_submission(self, form: HumanInputForm, form_data: dict[str, Any], action: str) -> None:
        """Validate form submission data."""
        form_definition = json.loads(form.form_definition)

        # Check that the action is valid
        valid_actions = {act.get("id") for act in form_definition.get("user_actions", [])}
        if action not in valid_actions:
            raise InvalidFormDataError(f"Invalid action: {action}")

        # Note: We don't validate required inputs here as the original implementation
        # allows extra inputs and doesn't strictly enforce all inputs to be present

    def cleanup_expired_forms(self) -> int:
        """Clean up expired forms. Returns the number of forms cleaned up."""
        try:
            domain_service = self._get_domain_service()
            return domain_service.cleanup_expired_forms()
        except (DomainNotFoundError, DomainExpiredError, DomainAlreadySubmittedError, DomainInvalidFormDataError) as e:
            if isinstance(e, DomainNotFoundError):
                raise HumanInputFormNotFoundError(e.identifier) from e
            elif isinstance(e, DomainExpiredError):
                raise HumanInputFormExpiredError() from e
            elif isinstance(e, DomainAlreadySubmittedError):
                raise HumanInputFormAlreadySubmittedError() from e
            elif isinstance(e, DomainInvalidFormDataError):
                raise InvalidFormDataError(e.message) from e

    def get_pending_forms_for_workflow_run(self, workflow_run_id: str) -> list[HumanInputForm]:
        """Get all pending human input forms for a workflow run."""
        try:
            domain_service = self._get_domain_service()
            domain_forms = domain_service.get_pending_forms_for_workflow_run(workflow_run_id)
            return [self._domain_to_db_model(domain_form) for domain_form in domain_forms]
        except (DomainNotFoundError, DomainExpiredError, DomainAlreadySubmittedError, DomainInvalidFormDataError) as e:
            if isinstance(e, DomainNotFoundError):
                raise HumanInputFormNotFoundError(e.identifier) from e
            elif isinstance(e, DomainExpiredError):
                raise HumanInputFormExpiredError() from e
            elif isinstance(e, DomainAlreadySubmittedError):
                raise HumanInputFormAlreadySubmittedError() from e
            elif isinstance(e, DomainInvalidFormDataError):
                raise InvalidFormDataError(e.message) from e
