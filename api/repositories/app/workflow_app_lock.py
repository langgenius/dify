from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model import App


def lock_workflow_app(*, app: App, session: Session) -> bool:
    """Lock the admitted Workflow or Chatflow owner until the caller ends its transaction.

    Take this lock before locking drafts or writing their bindings in transactions
    that can initialize a draft or mutate the App. Return False if the scoped
    owner is gone. Pending changes are never flushed by this lookup.
    """
    return (
        session.scalar(
            select(App.id)
            .where(App.tenant_id == app.tenant_id, App.id == app.id)
            .with_for_update()
            .execution_options(autoflush=False)
        )
        is not None
    )
