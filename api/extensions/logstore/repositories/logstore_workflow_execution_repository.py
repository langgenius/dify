import json
import logging
from datetime import datetime
from typing import Optional, Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.workflow.entities.workflow_execution import (
    WorkflowExecution,
    WorkflowExecutionStatus,
    WorkflowType,
)
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from extensions.logstore.aliyun_logstore import AliyunLogStore
from libs.helper import extract_tenant_id
from models import (
    Account,
    CreatorUserRole,
    EndUser,
)
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


class LogstoreWorkflowExecutionRepository(WorkflowExecutionRepository):

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: Optional[str],
        triggered_from: Optional[WorkflowRunTriggeredFrom],
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)
        """
        self.logstore_client = AliyunLogStore()
        self.logstore_client.init_project_logstore()

        # Extract tenant_id from user
        tenant_id = extract_tenant_id(user)
        if not tenant_id:
            raise ValueError("User must have a tenant_id or current_tenant_id")
        self._tenant_id = tenant_id

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._creator_user_id = user.id

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

        # todo:tmp
        self.sql_repository = SQLAlchemyWorkflowExecutionRepository(session_factory, user, app_id, triggered_from)

    def _to_domain_model(self, logstore_model: list[tuple[str, str]]) -> WorkflowExecution:
        """
        Convert a logstore model (List[Tuple[str, str]]) to a domain model.

        Args:
            logstore_model: The logstore model as a list of key-value tuples

        Returns:
            The domain model
        """
        # Convert list of tuples to dictionary for easier access
        logstore_dict = dict(logstore_model)

        # Parse JSON fields
        inputs = json.loads(logstore_dict.get('inputs', '{}'))
        outputs = json.loads(logstore_dict.get('outputs', '{}'))
        graph = json.loads(logstore_dict.get('graph', '{}'))

        # Convert status to domain enum
        status = WorkflowExecutionStatus(logstore_dict.get('status', 'running'))

        # Parse datetime fields
        started_at = datetime.fromisoformat(logstore_dict.get('started_at', ''))\
            if logstore_dict.get('started_at') else datetime.now()
        finished_at = datetime.fromisoformat(logstore_dict.get('finished_at', ''))\
            if logstore_dict.get('finished_at') else None

        return WorkflowExecution(
            id_=logstore_dict.get('id', ''),
            workflow_id=logstore_dict.get('workflow_id', ''),
            workflow_type=WorkflowType(logstore_dict.get('type', 'workflow')),
            workflow_version=logstore_dict.get('version', ''),
            graph=graph,
            inputs=inputs,
            outputs=outputs,
            status=status,
            error_message=logstore_dict.get('error_message', ''),
            total_tokens=int(logstore_dict.get('total_tokens', 0)),
            total_steps=int(logstore_dict.get('total_steps', 0)),
            exceptions_count=int(logstore_dict.get('exceptions_count', 0)),
            started_at=started_at,
            finished_at=finished_at,
        )

    def _to_logstore_model(self, domain_model: WorkflowExecution) -> list[tuple[str, str]]:
        """
        Convert a domain model to a logstore model (List[Tuple[str, str]]).

        Args:
            domain_model: The domain model to convert

        Returns:
            The logstore model as a list of key-value tuples
        """
        # Use values from constructor if provided
        if not self._triggered_from:
            raise ValueError("triggered_from is required in repository constructor")
        if not self._creator_user_id:
            raise ValueError("created_by is required in repository constructor")
        if not self._creator_user_role:
            raise ValueError("created_by_role is required in repository constructor")

        logstore_model = [
            ('id', domain_model.id_),
            ('tenant_id', self._tenant_id),
            ('app_id', self._app_id or ''),
            ('workflow_id', domain_model.workflow_id),
            ('triggered_from', self._triggered_from.value
                if hasattr(self._triggered_from, 'value') else str(self._triggered_from)),
            ('type', domain_model.workflow_type.value),
            ('version', domain_model.workflow_version),
            ('graph', json.dumps(domain_model.graph) if domain_model.graph else '{}'),
            ('inputs', json.dumps(domain_model.inputs) if domain_model.inputs else '{}'),
            ('outputs', json.dumps(domain_model.outputs) if domain_model.outputs else '{}'),
            ('status', domain_model.status.value),
            ('error_message', domain_model.error_message or ''),
            ('total_tokens', str(domain_model.total_tokens)),
            ('total_steps', str(domain_model.total_steps)),
            ('exceptions_count', str(domain_model.exceptions_count)),
            ('created_by_role', self._creator_user_role.value
                if hasattr(self._creator_user_role, 'value') else str(self._creator_user_role)),
            ('created_by', self._creator_user_id),
            ('started_at', domain_model.started_at.isoformat() if domain_model.started_at else ''),
            ('finished_at', domain_model.finished_at.isoformat() if domain_model.finished_at else ''),
        ]

        return logstore_model

    def save(self, execution: WorkflowExecution) -> None:
        """
        Save or update a WorkflowExecution domain entity to the database.

        This method serves as a domain-to-database adapter that:
        1. Converts the domain entity to its database representation
        2. Persists the database model using SQLAlchemy's merge operation
        3. Maintains proper multi-tenancy by including tenant context during conversion
        4. Updates the in-memory cache for faster subsequent lookups

        The method handles both creating new records and updating existing ones through
        SQLAlchemy's merge operation.

        Args:
            execution: The WorkflowExecution domain entity to persist
        """
        try:
            logstore_model = self._to_logstore_model(execution)
            self.logstore_client.put_log(AliyunLogStore.workflow_execution_logstore, logstore_model)

            logger.debug("Updating cache for execution_id: %s", execution.id_)
        except Exception as e:
            logger.exception(
                "Failed to update cache for execution_id: %s", execution.id_
            )

        # todo:tmp
        self.sql_repository.save(execution)
