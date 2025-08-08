from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.entities.trace_entity import BaseTraceInfo
from extensions.ext_database import db
from models import Account, App, TenantAccountJoin


class BaseTraceInstance(ABC):
    """
    Base trace instance for ops trace services
    """

    @abstractmethod
    def __init__(self, trace_config: BaseTracingConfig):
        """
        Abstract initializer for the trace instance.
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
        Get service account for an app and set up its tenant.

        Args:
            app_id: The ID of the app

        Returns:
            Account: The service account with tenant set up

        Raises:
            ValueError: If app, creator account or tenant cannot be found
        """
        with Session(db.engine, expire_on_commit=False) as session:
            # Get the app to find its creator
            app = session.query(App).where(App.id == app_id).first()
            if not app:
                raise ValueError(f"App with id {app_id} not found")

            if not app.created_by:
                raise ValueError(f"App with id {app_id} has no creator (created_by is None)")

            service_account = session.query(Account).where(Account.id == app.created_by).first()
            if not service_account:
                raise ValueError(f"Creator account with id {app.created_by} not found for app {app_id}")

            current_tenant = (
                session.query(TenantAccountJoin).filter_by(account_id=service_account.id, current=True).first()
            )
            if not current_tenant:
                raise ValueError(f"Current tenant not found for account {service_account.id}")
            service_account.set_tenant_id(current_tenant.tenant_id)

            return service_account
