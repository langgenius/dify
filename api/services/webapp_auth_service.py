from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from models.enums import EndUserType
from models.model import App, EndUser, Site


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
