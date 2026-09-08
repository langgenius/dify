"""Read and update the application's selected tracing settings."""

import json
from typing import Any

from core.ops.provider_config import get_provider_config_fields


def get_app_trace_settings(*, tenant_id: str, app_id: str) -> dict[str, Any]:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.model import App

    with Session(db.engine) as session:
        app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))
        if app is None:
            raise ValueError("App not found")
        return json.loads(app.tracing) if app.tracing else {"enabled": False, "tracing_provider": None}


def update_app_trace_settings(*, tenant_id: str, app_id: str, enabled: bool, tracing_provider: str | None) -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.model import App

    if tracing_provider is not None:
        get_provider_config_fields(tracing_provider)
    with Session(db.engine) as session, session.begin():
        app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
        if app is None:
            raise ValueError("App not found")
        app.tracing = json.dumps({"enabled": enabled, "tracing_provider": tracing_provider})
        app.tracing_revision += 1
