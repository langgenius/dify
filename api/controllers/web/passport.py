import uuid
from datetime import UTC, datetime, timedelta

from flask import make_response, request
from flask_restx import Resource
from sqlalchemy import func, select
from werkzeug.exceptions import NotFound, Unauthorized

from configs import dify_config
from constants import HEADER_NAME_APP_CODE
from controllers.web import web_ns
from controllers.web.error import WebAppAuthRequiredError
from extensions.ext_database import db
from libs.passport import PassportService
from libs.token import extract_webapp_access_token
from models.model import App, EndUser, Site
from services.feature_service import FeatureService
from services.webapp_auth_service import WebAppAuthService, WebAppAuthType


@web_ns.route("/passport")
class PassportResource(Resource):
    """Base resource for passport."""

    @web_ns.doc("get_passport")
    @web_ns.doc(description="Get authentication passport for web application access")
    @web_ns.doc(
        responses={
            200: "Passport retrieved successfully",
            401: "Unauthorized - missing app code or invalid authentication",
            404: "Application or user not found",
        }
    )
    def get(self):
        system_features = FeatureService.get_system_features()
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        user_id = request.args.get("user_id")
        access_token = extract_webapp_access_token(request)
        if app_code is None:
            raise Unauthorized("X-App-Code header is missing.")
        if system_features.webapp_auth.enabled:
            enterprise_user_decoded = decode_enterprise_webapp_user_id(access_token)
            app_auth_type = WebAppAuthService.get_app_auth_type(app_code=app_code)
            if app_auth_type != WebAppAuthType.PUBLIC:
                if not enterprise_user_decoded:
                    raise WebAppAuthRequiredError()
                return exchange_token_for_existing_web_user(
                    app_code=app_code, enterprise_user_decoded=enterprise_user_decoded, auth_type=app_auth_type
                )

        # get site from db and check if it is normal
        site = db.session.scalar(select(Site).where(Site.code == app_code, Site.status == "normal"))
        if not site:
            raise NotFound()
        # get app from db and check if it is normal and enable_site
        app_model = db.session.scalar(select(App).where(App.id == site.app_id))
        if not app_model or app_model.status != "normal" or not app_model.enable_site:
            raise NotFound()

        if user_id:
            end_user = db.session.scalar(
                select(EndUser).where(EndUser.app_id == app_model.id, EndUser.session_id == user_id)
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

        response = make_response(
            {
                "access_token": tk,
            }
        )
        return response


def decode_enterprise_webapp_user_id(jwt_token: str | None):
    """
    Decode the enterprise user session from the Authorization header.
    """
    if not jwt_token:
        return None

    decoded = PassportService().verify(jwt_token)
    source = decoded.get("token_source")
    if not source or source != "webapp_login_token":
        raise Unauthorized("Invalid token source. Expected 'webapp_login_token'.")
    return decoded


def exchange_token_for_existing_web_user(app_code: str, enterprise_user_decoded: dict, auth_type: WebAppAuthType):
    """
    Exchange a token for an existing web user session.
    """
    user_id = enterprise_user_decoded.get("user_id")
    end_user_id = enterprise_user_decoded.get("end_user_id")
    session_id = enterprise_user_decoded.get("session_id")
    user_auth_type = enterprise_user_decoded.get("auth_type")
    exchanged_token_expires_unix = enterprise_user_decoded.get("exp")

    if not user_auth_type:
        raise Unauthorized("Missing auth_type in the token.")

    site = db.session.scalar(select(Site).where(Site.code == app_code, Site.status == "normal"))
    if not site:
        raise NotFound()

    app_model = db.session.scalar(select(App).where(App.id == site.app_id))
    if not app_model or app_model.status != "normal" or not app_model.enable_site:
        raise NotFound()

    if auth_type == WebAppAuthType.PUBLIC:
        return _exchange_for_public_app_token(app_model, site, enterprise_user_decoded)
    elif auth_type == WebAppAuthType.EXTERNAL and user_auth_type != "external":
        raise WebAppAuthRequiredError("Please login as external user.")
    elif auth_type == WebAppAuthType.INTERNAL and user_auth_type != "internal":
        raise WebAppAuthRequiredError("Please login as internal user.")

    end_user = None
    if end_user_id:
        end_user = db.session.scalar(select(EndUser).where(EndUser.id == end_user_id))
    if session_id:
        end_user = db.session.scalar(
            select(EndUser).where(
                EndUser.session_id == session_id,
                EndUser.tenant_id == app_model.tenant_id,
                EndUser.app_id == app_model.id,
            )
        )
    if not end_user:
        if not session_id:
            raise NotFound("Missing session_id for existing web user.")
        end_user = EndUser(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type="browser",
            is_anonymous=True,
            session_id=session_id,
        )
        db.session.add(end_user)
        db.session.commit()

    exp = int((datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp())
    if exchanged_token_expires_unix:
        exp = int(exchanged_token_expires_unix)

    payload = {
        "iss": site.id,
        "sub": "Web API Passport",
        "app_id": site.app_id,
        "app_code": site.code,
        "user_id": user_id,
        "end_user_id": end_user.id,
        "auth_type": user_auth_type,
        "granted_at": int(datetime.now(UTC).timestamp()),
        "token_source": "webapp",
        "exp": exp,
    }
    token: str = PassportService().issue(payload)
    resp = make_response(
        {
            "access_token": token,
        }
    )
    return resp


def _exchange_for_public_app_token(app_model, site, token_decoded):
    user_id = token_decoded.get("user_id")
    end_user = None
    if user_id:
        end_user = db.session.scalar(
            select(EndUser).where(EndUser.app_id == app_model.id, EndUser.session_id == user_id)
        )

    if not end_user:
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
        "app_code": site.code,
        "end_user_id": end_user.id,
    }

    tk = PassportService().issue(payload)

    resp = make_response(
        {
            "access_token": tk,
        }
    )
    return resp


def generate_session_id():
    """
    Generate a unique session ID.
    """
    while True:
        session_id = str(uuid.uuid4())
        existing_count = db.session.scalar(
            select(func.count()).select_from(EndUser).where(EndUser.session_id == session_id)
        )
        if existing_count == 0:
            return session_id
