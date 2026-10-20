from abc import ABC, abstractmethod

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.entities.trace_entity import BaseTraceInfo
from extensions.ext_database import db
from models import Account, App


class BaseTraceInstance(ABC):
    """
    Base trace instance for ops trace services
    """

    def __init__(self, trace_config: BaseTracingConfig):
        """
        Initializer for the trace instance.
        Distribute trace tasks by matching entities
        """
        self.trace_config = trace_config

    @abstractmethod
    def trace(self, trace_info: BaseTraceInfo):
        """
        Abstract method to trace activities.
        Subclasses must implement specific tracing logic for activities.
        """
        ...

    def get_service_account_with_tenant(self, app_id: str) -> Account:
        """
        Get the app creator with the app's tenant and membership role.

        Trace tasks may run after the creator switches workspaces. Bind only the
        returned account's context without changing the creator's current workspace.

        Args:
            app_id: The ID of the app

        Returns:
            Account: The service account with the app's tenant set up

        Raises:
            ValueError: If the app, creator account, app tenant or membership cannot be found
        """
        with Session(db.engine, expire_on_commit=False) as session:
            # Get the app to find its creator
            app_stmt = select(App).where(App.id == app_id)
            app = session.scalar(app_stmt)
            if not app:
                raise ValueError(f"App with id {app_id} not found")

            if not app.created_by:
                raise ValueError(f"App with id {app_id} has no creator (created_by is None)")
            account_stmt = select(Account).where(Account.id == app.created_by)
            service_account = session.scalar(account_stmt)
            if not service_account:
                raise ValueError(f"Creator account with id {app.created_by} not found for app {app_id}")

            service_account.set_tenant_id_with_session(app.tenant_id, session=session)
            if service_account.current_tenant_id != app.tenant_id:
                raise ValueError(f"App tenant {app.tenant_id} not found for account {service_account.id}")

            return service_account
