"""Deployment admission shared by the existing Account login transports."""

from werkzeug.exceptions import Forbidden

from configs import dify_config
from services.entities.account_login_entities import LoginMode


def require_login_mode(mode: LoginMode, *, invite_token: str | None = None) -> None:
    if mode != LoginMode.END_USER:
        return
    if not dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED:
        raise Forbidden("End User login is not enabled.")
    if invite_token is not None:
        raise ValueError("End User login cannot accept a workspace invitation.")
