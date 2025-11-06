"""
SQLAlchemy implementation of the HumanInputFormRepository.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import and_, select

from core.workflow.entities.human_input_form import (
    HumanInputForm,
    HumanInputFormStatus,
    HumanInputSubmissionType,
    FormSubmission,
)
from core.workflow.repositories.human_input_form_repository import HumanInputFormRepository
from libs.helper import extract_tenant_id
from models.human_input import (
    HumanInputForm as HumanInputFormModel,
    HumanInputFormStatus as HumanInputFormStatusModel,
    HumanInputSubmissionType as HumanInputSubmissionTypeModel,
)
from models import Account, EndUser

logger = logging.getLogger(__name__)


class SQLAlchemyHumanInputFormRepository(HumanInputFormRepository):
    """
    SQLAlchemy implementation of the HumanInputFormRepository interface.

    This implementation supports multi-tenancy by filtering operations based on tenant_id.
    Each method creates its own session, handles the transaction, and commits changes
    to the database. This prevents long-running connections in the workflow core.
    """

    def __init__(
        self,
        session_factory: Union[sessionmaker, Engine],
        user: Union[Account, EndUser],
        app_id: str | None,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
        """
        # If an engine is provided, create a sessionmaker from it
        if isinstance(session_factory, Engine):
            self._session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)
        elif isinstance(session_factory, sessionmaker):
            self._session_factory = session_factory
        else:
            raise ValueError(
                f"Invalid session_factory type {type(session_factory).__name__}; expected sessionmaker or Engine"
            )

        # Extract tenant_id from user
        tenant_id = extract_tenant_id(user)
        if not tenant_id:
            raise ValueError("User must have a tenant_id or current_tenant_id")
        self._tenant_id = tenant_id

        # Store app context
        self._app_id = app_id

    def _to_domain_model(self, db_model: HumanInputFormModel) -> HumanInputForm:
        """
        Convert a database model to a domain model.

        Args:
            db_model: The database model to convert

        Returns:
            The domain model
        """
        # Parse JSON fields
        form_definition = json.loads(db_model.form_definition) if db_model.form_definition else {}

        # Create submission if present
        submission = None
        if db_model.status == HumanInputFormStatusModel.SUBMITTED and db_model.submitted_data:
            submission = FormSubmission(
                data=json.loads(db_model.submitted_data) if db_model.submitted_data else {},
                action="",  # Action is not stored separately in DB model, would need to be stored in submitted_data
                submitted_at=db_model.submitted_at or datetime.utcnow(),
                submission_type=HumanInputSubmissionType(db_model.submission_type.value)
                if db_model.submission_type
                else HumanInputSubmissionType.web_form,
                submission_user_id=db_model.submission_user_id,
                submission_end_user_id=db_model.submission_end_user_id,
                submitter_email=db_model.submitter_email,
            )

        return HumanInputForm(
            id_=db_model.id,
            workflow_run_id=db_model.workflow_run_id,
            form_definition=form_definition,
            rendered_content=db_model.rendered_content,
            status=HumanInputFormStatus(db_model.status.value),
            web_app_token=db_model.web_app_token,
            submission=submission,
            created_at=db_model.created_at,
        )

    def _to_db_model(self, domain_model: HumanInputForm) -> HumanInputFormModel:
        """
        Convert a domain model to a database model.

        Args:
            domain_model: The domain model to convert

        Returns:
            The database model
        """
        db_model = HumanInputFormModel()
        db_model.id = domain_model.id_
        db_model.tenant_id = self._tenant_id
        if self._app_id is not None:
            db_model.app_id = self._app_id
        db_model.workflow_run_id = domain_model.workflow_run_id
        db_model.form_definition = json.dumps(domain_model.form_definition) if domain_model.form_definition else None
        db_model.rendered_content = domain_model.rendered_content
        db_model.status = HumanInputFormStatusModel(domain_model.status.value)
        db_model.web_app_token = domain_model.web_app_token
        db_model.created_at = domain_model.created_at

        # Handle submission data
        if domain_model.submission:
            db_model.submitted_data = json.dumps(domain_model.submission.data) if domain_model.submission.data else None
            db_model.submitted_at = domain_model.submission.submitted_at
            db_model.submission_type = HumanInputSubmissionTypeModel(domain_model.submission.submission_type.value)
            db_model.submission_user_id = domain_model.submission.submission_user_id
            db_model.submission_end_user_id = domain_model.submission.submission_end_user_id
            db_model.submitter_email = domain_model.submission.submitter_email

        return db_model

    def save(self, form: HumanInputForm) -> None:
        """
        Save or update a HumanInputForm domain entity to the database.

        This method serves as a domain-to-database adapter that:
        1. Converts the domain entity to its database representation
        2. Persists the database model using SQLAlchemy's merge operation
        3. Maintains proper multi-tenancy by including tenant context during conversion

        The method handles both creating new records and updating existing ones through
        SQLAlchemy's merge operation.

        Args:
            form: The HumanInputForm domain entity to persist
        """
        db_model = self._to_db_model(form)

        with self._session_factory() as session:
            session.merge(db_model)
            session.commit()
            logger.info("Saved human input form %s", form.id_)

    def get_by_id(self, form_id: str) -> HumanInputForm:
        """Get a form by its ID."""
        with self._session_factory() as session:
            stmt = select(HumanInputFormModel).where(
                and_(
                    HumanInputFormModel.id == form_id,
                    HumanInputFormModel.tenant_id == self._tenant_id,
                )
            )
            if self._app_id is not None:
                stmt = stmt.where(HumanInputFormModel.app_id == self._app_id)

            db_model = session.scalar(stmt)
            if not db_model:
                raise ValueError(f"Human input form not found: {form_id}")

            return self._to_domain_model(db_model)

    def get_by_web_app_token(self, web_app_token: str) -> HumanInputForm:
        """Get a form by its web app token."""
        with self._session_factory() as session:
            stmt = select(HumanInputFormModel).where(
                and_(
                    HumanInputFormModel.web_app_token == web_app_token,
                    HumanInputFormModel.tenant_id == self._tenant_id,
                )
            )
            if self._app_id is not None:
                stmt = stmt.where(HumanInputFormModel.app_id == self._app_id)

            db_model = session.scalar(stmt)
            if not db_model:
                raise ValueError(f"Human input form not found with token: {web_app_token}")

            return self._to_domain_model(db_model)

    def get_pending_forms_for_workflow_run(self, workflow_run_id: str) -> list[HumanInputForm]:
        """Get all pending human input forms for a workflow run."""
        with self._session_factory() as session:
            stmt = select(HumanInputFormModel).where(
                and_(
                    HumanInputFormModel.workflow_run_id == workflow_run_id,
                    HumanInputFormModel.status == HumanInputFormStatusModel.WAITING,
                    HumanInputFormModel.tenant_id == self._tenant_id,
                )
            )
            if self._app_id is not None:
                stmt = stmt.where(HumanInputFormModel.app_id == self._app_id)

            db_models = list(session.scalars(stmt).all())
            return [self._to_domain_model(db_model) for db_model in db_models]

    def mark_expired_forms(self, expiry_hours: int = 48) -> int:
        """Mark expired forms as expired."""
        with self._session_factory() as session:
            expiry_time = datetime.utcnow() - timedelta(hours=expiry_hours)

            stmt = select(HumanInputFormModel).where(
                and_(
                    HumanInputFormModel.status == HumanInputFormStatusModel.WAITING,
                    HumanInputFormModel.created_at < expiry_time,
                    HumanInputFormModel.tenant_id == self._tenant_id,
                )
            )
            if self._app_id is not None:
                stmt = stmt.where(HumanInputFormModel.app_id == self._app_id)

            expired_forms = list(session.scalars(stmt).all())

            count = 0
            for form in expired_forms:
                form.status = HumanInputFormStatusModel.EXPIRED
                count += 1

            session.commit()
            logger.info("Marked %d forms as expired", count)
            return count

    def exists_by_id(self, form_id: str) -> bool:
        """Check if a form exists by ID."""
        with self._session_factory() as session:
            stmt = select(HumanInputFormModel).where(
                and_(
                    HumanInputFormModel.id == form_id,
                    HumanInputFormModel.tenant_id == self._tenant_id,
                )
            )
            if self._app_id is not None:
                stmt = stmt.where(HumanInputFormModel.app_id == self._app_id)

            return session.scalar(stmt) is not None

    def exists_by_web_app_token(self, web_app_token: str) -> bool:
        """Check if a form exists by web app token."""
        with self._session_factory() as session:
            stmt = select(HumanInputFormModel).where(
                and_(
                    HumanInputFormModel.web_app_token == web_app_token,
                    HumanInputFormModel.tenant_id == self._tenant_id,
                )
            )
            if self._app_id is not None:
                stmt = stmt.where(HumanInputFormModel.app_id == self._app_id)

            return session.scalar(stmt) is not None
