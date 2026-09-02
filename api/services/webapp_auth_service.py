from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from models.enums import EndUserType
from models.model import App, EndUser, Site
from services.app_service import AppService
from services.enterprise.enterprise_service import PERMISSION_CHECK_MODES, EnterpriseService


class WebAppAuthService:
    """Service for web app authentication."""

    @classmethod
    def create_end_user(cls, app_code, email, session: Session) -> EndUser:
        site = session.scalar(select(Site).where(Site.code == app_code).limit(1))
        if not site:
            raise NotFound("Site not found.")
        app_model = session.get(App, site.app_id)
        if not app_model:
            raise NotFound("App not found.")
        end_user = EndUser(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=EndUserType.BROWSER,
            is_anonymous=False,
            session_id=email,
            name="enterpriseuser",
            external_user_id="enterpriseuser",
        )
        session.add(end_user)
        session.commit()

        return end_user

    @classmethod
    def is_app_require_permission_check(
        cls, app_code: str | None = None, app_id: str | None = None, access_mode: str | None = None, *, session: Session
    ) -> bool:
        """
        Check if the app requires permission check based on its access mode.
        """
        if access_mode:
            return access_mode in PERMISSION_CHECK_MODES

        if not app_code and not app_id:
            raise ValueError("Either app_code or app_id must be provided.")

        if app_code:
            app_id = AppService.get_app_id_by_code(app_code, session=session)
        if not app_id:
            raise ValueError("App ID could not be determined from the provided app_code.")

        webapp_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id)
        if webapp_settings and webapp_settings.access_mode in PERMISSION_CHECK_MODES:
            return True
        return False
