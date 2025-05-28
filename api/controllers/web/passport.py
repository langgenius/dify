import uuid
from datetime import UTC, datetime, timedelta

from flask import request
from flask_restful import Resource
from werkzeug.exceptions import NotFound, Unauthorized

from configs import dify_config
from controllers.web import api
from controllers.web.error import WebAppAuthRequiredError
from extensions.ext_database import db
from libs.passport import PassportService
from models.model import App, EndUser, Site
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService


class PassportResource(Resource):
    """Base resource for passport."""

    def get(self):
        system_features = FeatureService.get_system_features()
        app_code = request.headers.get("X-App-Code")
        user_id = request.args.get("user_id")
        enterprise_login_token = request.args.get("enterprise_login_token")

        if app_code is None:
            raise Unauthorized("X-App-Code header is missing.")

        # logic for exchange token for enterprise logined web user
        enterprise_user_id = decode_enterprise_webapp_user_id(enterprise_login_token)
        if enterprise_user_id:
            # a web user has already logged in, exchange a token for this app without redirecting to the login page
            return exchange_token_for_existing_web_user(app_code=app_code, user_id=enterprise_user_id)

        if system_features.webapp_auth.enabled:
            app_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_code(app_code=app_code)
            if not app_settings or not app_settings.access_mode == "public":
                raise WebAppAuthRequiredError()

        # get site from db and check if it is normal
        site = db.session.query(Site).filter(Site.code == app_code, Site.status == "normal").first()
        if not site:
            raise NotFound()
        # get app from db and check if it is normal and enable_site
        app_model = db.session.query(App).filter(App.id == site.app_id).first()
        if not app_model or app_model.status != "normal" or not app_model.enable_site:
            raise NotFound()

        if user_id:
            end_user = (
                db.session.query(EndUser).filter(EndUser.app_id == app_model.id, EndUser.session_id == user_id).first()
            )

            if end_user:
                pass
            else:
                end_user = EndUser(
                    tenant_id=app_model.tenant_id,
                    app_id=app_model.id,
                    type="browser",
                    is_anonymous=True,
                    session_id=user_id,
                )
                db.session.add(end_user)
                db.session.commit()
        else:
            end_user = EndUser(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type="browser",
                is_anonymous=True,
                session_id=generate_session_id(),
            )
            db.session.add(end_user)
            db.session.commit()

        payload = {
            "iss": site.app_id,
            "sub": "Web API Passport",
            "app_id": site.app_id,
            "app_code": app_code,
            "end_user_id": end_user.id,
        }

        tk = PassportService().issue(payload)

        return {
            "access_token": tk,
        }


api.add_resource(PassportResource, "/passport")


def decode_enterprise_webapp_user_id(auth_header: str | None):
    """
    Decode the enterprise user session from the Authorization header.
    """
    if not auth_header:
        return None

    if " " not in auth_header:
        raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")

    auth_scheme, tk = auth_header.split(None, 1)
    auth_scheme = auth_scheme.lower()

    if auth_scheme != "bearer":
        raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")

    decoded = PassportService().verify(tk)
    source = decoded.get("token_source")
    if not source or source != "enterprise_login":
        return None
    user_id: str | None = decoded.get("user_id")
    return user_id


def exchange_token_for_existing_web_user(app_code: str, user_id: str):
    """
    Exchange a token for an existing web user session.
    """

    site = db.session.query(Site).filter(Site.code == app_code, Site.status == "normal").first()
    if not site:
        raise NotFound()

    app_model = db.session.query(App).filter(App.id == site.app_id).first()
    if not app_model or app_model.status != "normal" or not app_model.enable_site:
        raise NotFound()
    end_user = db.session.query(EndUser).filter(EndUser.app_id == app_model.id, EndUser.session_id == user_id).first()
    if not end_user:
        end_user = EndUser(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type="browser",
            is_anonymous=True,
            session_id=user_id,
        )
        db.session.add(end_user)
        db.session.commit()

    exp_dt = datetime.now(UTC) + timedelta(hours=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES * 24)
    exp = int(exp_dt.timestamp())
    payload = {
        "iss": site.id,
        "sub": "Web API Passport",
        "app_id": site.app_id,
        "app_code": site.code,
        "user_id": user_id,
        "end_user_id": end_user.id,
        "token_source": "webapp",
        "exp": exp,
    }
    token: str = PassportService().issue(payload)
    return {
        "access_token": token,
    }


def generate_session_id():
    """
    Generate a unique session ID.
    """
    while True:
        session_id = str(uuid.uuid4())
        existing_count = db.session.query(EndUser).filter(EndUser.session_id == session_id).count()
        if existing_count == 0:
            return session_id
