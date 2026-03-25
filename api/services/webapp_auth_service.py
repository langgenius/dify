import enum
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from werkzeug.exceptions import NotFound, Unauthorized

from configs import dify_config
from extensions.ext_database import db
from libs.helper import TokenManager
from libs.passport import PassportService
from libs.password import compare_password
from models import Account, AccountStatus
from models.model import App, EndUser, Site
from services.account_service import AccountService
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.errors.account import AccountLoginError, AccountNotFoundError, AccountPasswordError
from tasks.mail_email_code_login import send_email_code_login_mail_task


class WebAppAuthType(enum.StrEnum):
    """Enum for web app authentication types."""

    PUBLIC = "public"
    INTERNAL = "internal"
    EXTERNAL = "external"


class WebAppAuthService:
    """Service for web app authentication."""

    @staticmethod
    def authenticate(email: str, password: str) -> Account:
        """authenticate account with email and password"""
        account = AccountService.get_account_by_email_with_case_fallback(email)
        if not account:
            raise AccountNotFoundError()

        if account.status == AccountStatus.BANNED:
            raise AccountLoginError("Account is banned.")

        if account.password is None or not compare_password(password, account.password, account.password_salt):
            raise AccountPasswordError("Invalid email or password.")

        return account

    @classmethod
    def login(cls, account: Account) -> str:
        access_token = cls._get_account_jwt_token(account=account)

        return access_token

    @classmethod
    def get_user_through_email(cls, email: str):
        account = AccountService.get_account_by_email_with_case_fallback(email)
        if not account:
            return None

        if account.status == AccountStatus.BANNED:
            raise Unauthorized("Account is banned.")

        return account

    @classmethod
    def send_email_code_login_email(
        cls, account: Account | None = None, email: str | None = None, language: str = "en-US"
    ):
        email = account.email if account else email
        if email is None:
            raise ValueError("Email must be provided.")

        code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        token = TokenManager.generate_token(
            account=account, email=email, token_type="email_code_login", additional_data={"code": code}
        )
        send_email_code_login_mail_task.delay(
            language=language,
            to=account.email if account else email,
            code=code,
        )

        return token

    @classmethod
    def get_email_code_login_data(cls, token: str) -> dict[str, Any] | None:
        return TokenManager.get_token_data(token, "email_code_login")

    @classmethod
    def revoke_email_code_login_token(cls, token: str):
        TokenManager.revoke_token(token, "email_code_login")

    @classmethod
    def create_end_user(cls, app_code, email) -> EndUser:
        site = db.session.query(Site).where(Site.code == app_code).first()
        if not site:
            raise NotFound("Site not found.")
        app_model = db.session.query(App).where(App.id == site.app_id).first()
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
    def _get_account_jwt_token(cls, account: Account) -> str:
        exp_dt = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES * 24)
        exp = int(exp_dt.timestamp())

        payload = {
            "sub": "Web API Passport",
            "user_id": account.id,
            "session_id": account.email,
            "token_source": "webapp_login_token",
            "auth_type": "internal",
            "exp": exp,
        }

        token: str = PassportService().issue(payload)
        return token

    @classmethod
    def is_app_require_permission_check(
        cls, app_code: str | None = None, app_id: str | None = None, access_mode: str | None = None
    ) -> bool:
        """
        Check if the app requires permission check based on its access mode.
        """
        modes_requiring_permission_check = [
            "private",
            "private_all",
        ]
        if access_mode:
            return access_mode in modes_requiring_permission_check

        if not app_code and not app_id:
            raise ValueError("Either app_code or app_id must be provided.")

        if app_code:
            app_id = AppService.get_app_id_by_code(app_code)
        if not app_id:
            raise ValueError("App ID could not be determined from the provided app_code.")

        webapp_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id)
        if webapp_settings and webapp_settings.access_mode in modes_requiring_permission_check:
            return True
        return False

    @classmethod
    def get_app_auth_type(cls, app_code: str | None = None, access_mode: str | None = None) -> WebAppAuthType:
        """
        Get the authentication type for the app based on its access mode.
        """
        if not app_code and not access_mode:
            raise ValueError("Either app_code or access_mode must be provided.")

        if access_mode:
            if access_mode == "public":
                return WebAppAuthType.PUBLIC
            elif access_mode in ["private", "private_all"]:
                return WebAppAuthType.INTERNAL
            elif access_mode == "sso_verified":
                return WebAppAuthType.EXTERNAL

        if app_code:
            app_id = AppService.get_app_id_by_code(app_code)
            webapp_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=app_id)
            return cls.get_app_auth_type(access_mode=webapp_settings.access_mode)

        raise ValueError("Could not determine app authentication type.")
