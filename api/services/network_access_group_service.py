from typing import Any

from sqlalchemy import select

from extensions.ext_database import db
from models import App


class NetworkAccessGroupService:
    """Dify-side orchestration for SaaS network access group responses."""

    @staticmethod
    def enrich_app_references(
        payload: dict[str, Any],
        tenant_id: str,
    ) -> dict[str, Any]:
        """Attach tenant-scoped App display metadata to one or more group payloads."""

        raw_groups: list[object] = []
        if isinstance(payload.get("group"), dict):
            raw_groups.append(payload["group"])
        if isinstance(payload.get("groups"), list):
            raw_groups.extend(payload["groups"])

        groups = [group for group in raw_groups if isinstance(group, dict)]
        for group in groups:
            raw_app_ids = (
                group.get("used_by_app_ids")
                or group.get("usedByAppIds")
                or group.get("app_ids")
                or group.get("appIds")
                or []
            )
            group["app_ids"] = list(raw_app_ids) if isinstance(raw_app_ids, list) else raw_app_ids
            raw_count = group.get("used_by_count")
            if raw_count is None:
                raw_count = group.get("usedByCount")
            if raw_count is None:
                raw_count = len(raw_app_ids) if isinstance(raw_app_ids, list) else 0
            group["used_by_count"] = raw_count

        app_ids = {
            str(app_id)
            for group in groups
            if isinstance(group["app_ids"], list)
            for app_id in group["app_ids"]
            if app_id
        }
        if not app_ids:
            for group in groups:
                group["apps"] = []
            return payload

        app_models = db.session.scalars(
            select(App).where(
                App.tenant_id == tenant_id,
                App.id.in_(app_ids),
                App.status == "normal",
            )
        ).all()
        apps_by_id = {
            str(app.id): {
                "id": str(app.id),
                "name": app.name,
                "icon": app.icon,
                "icon_type": getattr(app.icon_type, "value", app.icon_type) if app.icon_type is not None else None,
                "icon_background": app.icon_background,
            }
            for app in app_models
        }
        for group in groups:
            group_app_ids = group["app_ids"] if isinstance(group["app_ids"], list) else []
            group["apps"] = [apps_by_id[str(app_id)] for app_id in group_app_ids if str(app_id) in apps_by_id]
        return payload
