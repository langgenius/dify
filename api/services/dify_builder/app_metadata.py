"""Small native App metadata adapter, used after an approved draft write."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from models.model import App
from services.app_service import AppService
from services.dify_builder.task_controls import lock_execution

logger = logging.getLogger(__name__)


class NativeAppMetadata:
    def __init__(self, factory: sessionmaker) -> None:
        self._factory = factory

    def describe_empty_app(self, *, app_id: str, tenant_id: str, account_id: str, description: str) -> str:
        """Fill only an empty description; preserve every user-selected identity."""
        description = description.strip()[:1024]
        if not description:
            return ""
        try:
            with self._factory() as sql:
                lock_execution(sql, app_id=app_id)
                app = sql.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
                if app is None:
                    return ""
                if not app.description:
                    AppService().describe_app(app, description, account_id=account_id, session=sql)
                return app.description
        except Exception:
            logger.warning("dify_builder description update unavailable for app %s", app_id, exc_info=True)
            return ""
