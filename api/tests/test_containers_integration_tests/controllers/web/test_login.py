"""Web login rejection with the account application service and real persistence."""

from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from controllers.console import wraps
from controllers.web.login import EmailCodeLoginSendEmailApi
from enums import DeploymentEdition
from models.account import Account, AccountStatus


def test_email_code_login_rejects_persisted_banned_account(
    flask_app_with_containers: Flask, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = Account(name="Banned", email=f"banned-{uuid4()}@example.com", status=AccountStatus.BANNED)
    db_session_with_containers.add(account)
    db_session_with_containers.commit()
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(wraps, "_is_setup_completed", lambda: True)

    with (
        flask_app_with_containers.test_request_context(
            "/api/email-code-login", method="POST", json={"email": account.email, "language": "en-US"}
        ),
        pytest.raises(Unauthorized, match="Account is banned."),
    ):
        EmailCodeLoginSendEmailApi().post()
