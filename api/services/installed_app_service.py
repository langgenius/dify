from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session, scoped_session

from libs.helper import escape_like_pattern
from models import App, AppModelConfig, InstalledApp, Workflow
from models.model import AppMode
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService


class InstalledAppCursor(BaseModel):
    is_pinned: bool
    last_used_at: datetime | None
    installed_app_id: str


def _published_app_filter():
    """Return the SQL predicate for installed-app web API availability.

    The installed-app parameters endpoint reads the published workflow for
    workflow-style apps and the published app model config for easy UI apps.
    Keep the list endpoint aligned in SQL so it does not return entries that
    will immediately fail with app_unavailable when opened.
    """
    workflow_app_modes = (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW)
    has_published_workflow = exists(select(Workflow.id).where(Workflow.id == App.workflow_id))
    has_published_model_config = exists(select(AppModelConfig.id).where(AppModelConfig.id == App.app_model_config_id))

    return and_(
        App.mode != AppMode.AGENT,
        or_(
            and_(App.mode.in_(workflow_app_modes), App.workflow_id.isnot(None), has_published_workflow),
            and_(~App.mode.in_(workflow_app_modes), App.app_model_config_id.isnot(None), has_published_model_config),
        ),
    )


def _installed_app_cursor_filter(cursor: InstalledAppCursor):
    same_pin_group = InstalledApp.is_pinned == cursor.is_pinned
    if cursor.last_used_at is None:
        later_in_pin_group = and_(
            InstalledApp.last_used_at.is_(None),
            InstalledApp.id > cursor.installed_app_id,
        )
    else:
        later_in_pin_group = or_(
            InstalledApp.last_used_at < cursor.last_used_at,
            InstalledApp.last_used_at.is_(None),
            and_(
                InstalledApp.last_used_at == cursor.last_used_at,
                InstalledApp.id > cursor.installed_app_id,
            ),
        )

    if cursor.is_pinned:
        return or_(
            InstalledApp.is_pinned.is_(False),
            and_(same_pin_group, later_in_pin_group),
        )
    return and_(same_pin_group, later_in_pin_group)


def _installed_app_order_by():
    return (
        InstalledApp.is_pinned.desc(),
        InstalledApp.last_used_at.desc().nulls_last(),
        InstalledApp.id.asc(),
    )


def _filter_rows_by_webapp_auth(
    rows: list[tuple[InstalledApp, App]],
    *,
    user_id: str,
) -> list[tuple[InstalledApp, App]]:
    if not rows:
        return []

    app_ids = [app.id for _, app in rows]
    webapp_settings = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(app_ids)
    candidates = [
        (installed_app, app)
        for installed_app, app in rows
        if (setting := webapp_settings.get(app.id)) is not None and setting.access_mode != "sso_verified"
    ]
    permissions = EnterpriseService.WebAppAuth.batch_is_user_allowed_to_access_webapps(
        user_id=user_id,
        app_ids=[app.id for _, app in candidates],
    )
    return [(installed_app, app) for installed_app, app in candidates if permissions.get(app.id)]


class InstalledAppService:
    @classmethod
    def get_visible_page(
        cls,
        *,
        tenant_id: str,
        user_id: str,
        cursor: InstalledAppCursor | None,
        limit: int,
        app_id: str | None,
        name: str | None,
        session: Session | scoped_session,
    ) -> tuple[list[tuple[InstalledApp, App]], bool, InstalledAppCursor | None]:
        """Scan ordered candidates until one page of authorized apps is complete."""
        stmt = (
            select(InstalledApp, App)
            .join(App, App.id == InstalledApp.app_id)
            .where(InstalledApp.tenant_id == tenant_id, _published_app_filter())
        )
        if app_id:
            stmt = stmt.where(InstalledApp.app_id == app_id)
        if name and (normalized_name := name.strip()):
            escaped_name = escape_like_pattern(normalized_name)
            stmt = stmt.where(App.name.ilike(f"%{escaped_name}%", escape="\\"))

        webapp_auth_enabled = FeatureService.get_system_features().webapp_auth.enabled
        scan_size = limit * 2 if webapp_auth_enabled else limit + 1
        visible_rows: list[tuple[InstalledApp, App]] = []
        scan_cursor = cursor
        has_more = False
        last_consumed_app: InstalledApp | None = None

        while True:
            page_stmt = stmt
            if scan_cursor is not None:
                page_stmt = page_stmt.where(_installed_app_cursor_filter(scan_cursor))
            candidate_result = session.execute(page_stmt.order_by(*_installed_app_order_by()).limit(scan_size)).all()
            candidate_rows = [(installed_app, app) for installed_app, app in candidate_result]
            if not candidate_rows:
                break

            authorized_rows = candidate_rows
            if webapp_auth_enabled:
                authorized_rows = _filter_rows_by_webapp_auth(candidate_rows, user_id=user_id)

            authorized_installed_app_ids = {installed_app.id for installed_app, _ in authorized_rows}
            for row in candidate_rows:
                installed_app = row[0]
                if installed_app.id not in authorized_installed_app_ids:
                    last_consumed_app = installed_app
                    continue
                if len(visible_rows) == limit:
                    has_more = True
                    break
                visible_rows.append(row)
                last_consumed_app = installed_app
            if has_more:
                break

            if len(candidate_rows) < scan_size:
                break
            last_scanned_app = candidate_rows[-1][0]
            scan_cursor = InstalledAppCursor(
                is_pinned=last_scanned_app.is_pinned,
                last_used_at=last_scanned_app.last_used_at,
                installed_app_id=last_scanned_app.id,
            )

        next_cursor = (
            InstalledAppCursor(
                is_pinned=last_consumed_app.is_pinned,
                last_used_at=last_consumed_app.last_used_at,
                installed_app_id=last_consumed_app.id,
            )
            if has_more and last_consumed_app
            else None
        )
        return visible_rows, has_more, next_cursor

    @staticmethod
    def get_published_app(app_id: str, *, session: Session | scoped_session) -> App | None:
        return session.scalar(select(App).where(App.id == app_id, _published_app_filter()).limit(1))
