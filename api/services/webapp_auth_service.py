import random
from datetime import UTC, datetime, timedelta
from typing import Any, Optional, cast

from werkzeug.exceptions import Unauthorized

from configs import dify_config
from extensions.ext_database import db
from libs.helper import TokenManager
from libs.passport import PassportService
from libs.password import compare_password
from models.account import Account, AccountStatus
from models.model import App, EndUser, Site
from services.errors.account import (AccountLoginError, AccountNotFoundError,
                                     AccountPasswordError)
from tasks.mail_email_code_login import send_email_code_login_mail_task


class WebAppAuthService:
    """Service for web app authentication."""

    @staticmethod
    def authenticate(email: str, password: str) -> Account:
        """authenticate account with email and password"""
        account = db.session.query(Account).filter_by(email=email).first()
        if not account:
            raise AccountNotFoundError()

        if account.status == AccountStatus.BANNED.value:
            raise AccountLoginError("Account is banned.")

        if account.password is None or not compare_password(password, account.password, account.password_salt):
            raise AccountPasswordError("Invalid email or password.")

        return cast(Account, account)

    @classmethod
    def login(cls, account: Account) -> str:
        access_token = cls._get_account_jwt_token(account=account)

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
        app_model = db.session.query(App).filter(App.id == site.app_id).first()
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
        exp_dt = datetime.now(UTC) + timedelta(hours=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES * 24)
        exp = int(exp_dt.timestamp())

        payload = {
            "sub": "Web API Passport",
            "user_id": account.id,
            "token_source": "webapp_login_token",
            "exp": exp,
        }

        token: str = PassportService().issue(payload)
        return token
