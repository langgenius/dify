import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from configs import dify_config
from libs.helper import TokenManager
from libs.passport import PassportService
from models.enums import EndUserType
from models.model import App, EndUser, Site
from services.entities.account_entities import AccountSnapshot
from tasks.mail_email_code_login import send_email_code_login_mail_task


class WebAppAuthService:
    """Service for web app authentication."""

    @classmethod
    def login(cls, account: AccountSnapshot) -> str:
        access_token = cls._get_account_jwt_token(account=account)

        return access_token

    @classmethod
    def send_email_code_login_email(
        cls, account: AccountSnapshot | None = None, email: str | None = None, language: str = "en-US"
    ):
        email = account.email if account else email
        if email is None:
            raise ValueError("Email must be provided.")

        code = "".join([str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6)])
        token = TokenManager.generate_token(
            account_id=account.id if account else None,
            email=email,
            token_type="email_code_login",
            additional_data={"code": code},
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
    def _get_account_jwt_token(cls, account: AccountSnapshot) -> str:
        exp_dt = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)
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
