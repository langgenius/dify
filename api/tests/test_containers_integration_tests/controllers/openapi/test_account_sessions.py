from __future__ import annotations

from collections.abc import Callable
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.openapi._models import SessionListQuery
from controllers.openapi.account import (
    AccountSessionByIdApi,
    AccountSessionsApi,
    AccountSessionsSelfApi,
)
from extensions.ext_redis import redis_client
from models import Account
from services.oauth_device_flow import PREFIX_OAUTH_ACCOUNT, MintResult, mint_oauth_token
from tests.test_containers_integration_tests.controllers.openapi.conftest import account_auth_context, auth_for


def _mint_account_token(
    db_session: Session,
    account: Account,
    *,
    client_id: str = "integration-cli",
    device_label: str = "Test Device",
) -> MintResult:
    """Mint a real, persisted ``dfoa_`` access token for ``account``."""
    return mint_oauth_token(
        db_session,
        redis_client,
        subject_email=account.email,
        subject_issuer=None,
        account_id=str(account.id),
        client_id=client_id,
        device_label=device_label,
        prefix=PREFIX_OAUTH_ACCOUNT,
        ttl_days=14,
    )


class TestSessionList:
    def test_lists_active_session(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        mint = _mint_account_token(db_session_with_containers, account, device_label="Laptop")

        api = AccountSessionsApi()
        with app.test_request_context("/openapi/v1/account/sessions"):
            with account_auth_context(account, token_id=mint.token_id):
                result = unwrap(api.get)(
                    api, auth_data=auth_for(account, token_id=mint.token_id), query=SessionListQuery()
                )

        assert result.total == 1
        row = result.data[0]
        assert row.id == str(mint.token_id)
        assert row.prefix == PREFIX_OAUTH_ACCOUNT
        assert row.device_label == "Laptop"

    def test_excludes_other_accounts_sessions(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        """Sessions are subject-scoped: another account's token must not appear."""
        account = make_account()
        other = make_account()
        mine = _mint_account_token(db_session_with_containers, account)
        _mint_account_token(db_session_with_containers, other)

        api = AccountSessionsApi()
        with app.test_request_context("/openapi/v1/account/sessions"):
            with account_auth_context(account, token_id=mine.token_id):
                result = unwrap(api.get)(
                    api, auth_data=auth_for(account, token_id=mine.token_id), query=SessionListQuery()
                )

        assert {row.id for row in result.data} == {str(mine.token_id)}


class TestSessionRevoke:
    def test_revoke_self_removes_from_active_list(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        mint = _mint_account_token(db_session_with_containers, account)

        revoke_api = AccountSessionsSelfApi()
        with app.test_request_context("/openapi/v1/account/sessions/self", method="DELETE"):
            with account_auth_context(account, token_id=mint.token_id):
                result = unwrap(revoke_api.delete)(revoke_api, auth_data=auth_for(account, token_id=mint.token_id))

        assert result.status == "revoked"

        # Revocation persisted: the real list path no longer returns it.
        list_api = AccountSessionsApi()
        with app.test_request_context("/openapi/v1/account/sessions"):
            with account_auth_context(account, token_id=mint.token_id):
                listing = unwrap(list_api.get)(
                    list_api, auth_data=auth_for(account, token_id=mint.token_id), query=SessionListQuery()
                )
        assert listing.total == 0

    def test_revoke_by_id_for_own_session(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        mint = _mint_account_token(db_session_with_containers, account)
        session_id = str(mint.token_id)

        api = AccountSessionByIdApi()
        with app.test_request_context(f"/openapi/v1/account/sessions/{session_id}", method="DELETE"):
            with account_auth_context(account, token_id=mint.token_id):
                result = unwrap(api.delete)(
                    api, session_id=session_id, auth_data=auth_for(account, token_id=mint.token_id)
                )

        assert result.status == "revoked"

    def test_revoke_foreign_session_is_404(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        """A token id owned by another subject must be indistinguishable from a
        missing one (404), so token ids can't be probed across subjects."""
        owner = make_account()
        outsider = make_account()
        foreign = _mint_account_token(db_session_with_containers, owner)

        api = AccountSessionByIdApi()
        session_id = str(foreign.token_id)
        with app.test_request_context(f"/openapi/v1/account/sessions/{session_id}", method="DELETE"):
            with account_auth_context(outsider, token_id=uuid4()):
                with pytest.raises(NotFound):
                    unwrap(api.delete)(api, session_id=session_id, auth_data=auth_for(outsider, token_id=uuid4()))
