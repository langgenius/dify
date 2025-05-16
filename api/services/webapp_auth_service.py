import random
from datetime import UTC, datetime, timedelta
from typing import Any, Optional, cast

from werkzeug.exceptions import NotFound, Unauthorized

from configs import dify_config
from controllers.web.error import WebAppAuthAccessDeniedError
from extensions.ext_database import db
from libs.helper import TokenManager
from libs.passport import PassportService
from libs.password import compare_password
from models.account import Account, AccountStatus
from models.model import App, EndUser, Site
from services.enterprise.enterprise_service import EnterpriseService
from services.errors.account import AccountLoginError, AccountNotFoundError, AccountPasswordError
from services.feature_service import FeatureService
from tasks.mail_email_code_login import send_email_code_login_mail_task


class WebAppAuthService:
    """Service for web app authentication."""

    @staticmethod
    def authenticate(email: str, password: str) -> Account:
        """authenticate account with email and password"""

        account = Account.query.filter_by(email=email).first()
        if not account:
            raise AccountNotFoundError()

        if account.status == AccountStatus.BANNED.value:
            raise AccountLoginError("Account is banned.")

        if account.password is None or not compare_password(password, account.password, account.password_salt):
            raise AccountPasswordError("Invalid email or password.")

        return cast(Account, account)

    @classmethod
    def login(cls, account: Account, app_code: str, end_user_id: str) -> str:
        site = db.session.query(Site).filter(Site.code == app_code).first()
        if not site:
            raise NotFound("Site not found.")

        access_token = cls._get_account_jwt_token(account=account, site=site, end_user_id=end_user_id)

        return access_token

    @classmethod
    def get_user_through_email(cls, email: str):
        account = db.session.query(Account).filter(Account.email == email).first()
        if not account:
            return None

        if account.status == AccountStatus.BANNED.value:
            raise Unauthorized("Account is banned.")

        return account

    @classmethod
    def send_email_code_login_email(
        cls, account: Optional[Account] = None, email: Optional[str] = None, language: Optional[str] = "en-US"
    ):
        email = account.email if account else email
        if email is None:
            raise ValueError("Email must be provided.")

        code = "".join([str(random.randint(0, 9)) for _ in range(6)])
        token = TokenManager.generate_token(
            account=account, email=email, token_type="webapp_email_code_login", additional_data={"code": code}
        )
        send_email_code_login_mail_task.delay(
            language=language,
            to=account.email if account else email,
            code=code,
        )

        return token

    @classmethod
    def get_email_code_login_data(cls, token: str) -> Optional[dict[str, Any]]:
        return TokenManager.get_token_data(token, "webapp_email_code_login")

    @classmethod
    def revoke_email_code_login_token(cls, token: str):
        TokenManager.revoke_token(token, "webapp_email_code_login")

    @classmethod
    def create_end_user(cls, app_code, email) -> EndUser:
        site = db.session.query(Site).filter(Site.code == app_code).first()
        if not site:
            raise NotFound("Site not found.")
        app_model = db.session.query(App).filter(App.id == site.app_id).first()
        if not app_model:
            raise NotFound("App not found.")
        end_user = EndUser(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type="browser",
            is_anonymous=False,
            session_id=email,
            name="enterpriseuser",
            external_user_id="enterpriseuser",
        )
        db.session.add(end_user)
        db.session.commit()

        return end_user

    @classmethod
    def _validate_user_accessibility(cls, account: Account, app_code: str):
        """Check if the user is allowed to access the app."""
        system_features = FeatureService.get_system_features()
        if system_features.webapp_auth.enabled:
            app_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_code(app_code=app_code)

            if (
                app_settings.access_mode != "public"
                and not EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(account.id, app_code=app_code)
            ):
                raise WebAppAuthAccessDeniedError()

    @classmethod
    def _get_account_jwt_token(cls, account: Account, site: Site, end_user_id: str) -> str:
        exp_dt = datetime.now(UTC) + timedelta(hours=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES * 24)
        exp = int(exp_dt.timestamp())

        payload = {
            "iss": site.id,
            "sub": "Web API Passport",
            "app_id": site.app_id,
            "app_code": site.code,
            "user_id": account.id,
            "end_user_id": end_user_id,
            "token_source": "webapp",
            "exp": exp,
        }

        token: str = PassportService().issue(payload)
        return token
