from __future__ import annotations

from collections.abc import Callable

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.openapi._models import SessionListQuery
from controllers.openapi.account import (
    AccountSessionByIdApi,
    AccountSessionsApi,
    AccountSessionsSelfApi,
)
from controllers.openapi.auth.requirements import CheckSessionOwnership
from extensions.ext_redis import redis_client
from libs.oauth_bearer import TokenType
from models import Account
from services.oauth_device_flow import MintResult, mint_oauth_token
from tests.test_containers_integration_tests.controllers.openapi.conftest import account_auth_context, context_for


def _mint_account_token(
    db_session: Session,
    account: Account,
    *,
    client_id: str = "integration-cli",
    device_label: str = "Test Device",
) -> MintResult:
    """Mint a real, persisted ``dfoa_`` access token for ``account``."""
    return mint_oauth_token(
        redis_client,
        subject_email=account.email,
        subject_issuer=None,
        account_id=str(account.id),
        client_id=client_id,
        device_label=device_label,
        token_type=TokenType.OAUTH_ACCOUNT,
        ttl_days=14,
        session=db_session,
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
                result = api.get.__handler__(
                    api,
                    context_for(account, session=db_session_with_containers, token_id=mint.token_id),
                    query=SessionListQuery(),
                )

        assert result.total == 1
        row = result.data[0]
        assert row.id == str(mint.token_id)
        assert row.prefix == TokenType.OAUTH_ACCOUNT.prefix
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
                result = api.get.__handler__(
                    api,
                    context_for(account, session=db_session_with_containers, token_id=mine.token_id),
                    query=SessionListQuery(),
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
                result = revoke_api.delete.__handler__(
                    revoke_api, context_for(account, session=db_session_with_containers, token_id=mint.token_id)
                )

        assert result.status == "revoked"

        # Revocation persisted: the real list path no longer returns it.
        list_api = AccountSessionsApi()
        with app.test_request_context("/openapi/v1/account/sessions"):
            with account_auth_context(account, token_id=mint.token_id):
                listing = list_api.get.__handler__(
                    list_api,
                    context_for(account, session=db_session_with_containers, token_id=mint.token_id),
                    query=SessionListQuery(),
                )
        assert listing.total == 0

    def test_revoke_by_id_for_own_session(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        account = make_account()
        mint = _mint_account_token(db_session_with_containers, account)
        session_id = str(mint.token_id)

        api = AccountSessionByIdApi()
        ctx = context_for(
            account,
            session=db_session_with_containers,
            view_args={"session_id": session_id},
            token_id=mint.token_id,
        )
        with app.test_request_context(f"/openapi/v1/account/sessions/{session_id}", method="DELETE"):
            request.view_args = {"session_id": session_id}
            with account_auth_context(account, token_id=mint.token_id):
                CheckSessionOwnership().run(ctx.subject, ctx, db_session_with_containers)
                result = api.delete.__handler__(api, ctx, session_id)

        assert result.status == "revoked"

    def test_revoke_foreign_session_is_404(
        self, app: Flask, db_session_with_containers: Session, make_account: Callable[..., Account]
    ) -> None:
        """A token id owned by another subject must be indistinguishable from a
        missing one (404), so token ids can't be probed across subjects.

        The refusal is `CheckSessionOwnership`'s, so it is exercised where the
        router runs it — ahead of the handler, which no longer checks.
        """
        owner = make_account()
        outsider = make_account()
        foreign = _mint_account_token(db_session_with_containers, owner)

        session_id = str(foreign.token_id)
        ctx = context_for(outsider, session=db_session_with_containers, view_args={"session_id": session_id})
        with app.test_request_context(f"/openapi/v1/account/sessions/{session_id}", method="DELETE"):
            request.view_args = {"session_id": session_id}
            with pytest.raises(NotFound):
                CheckSessionOwnership().run(ctx.subject, ctx, db_session_with_containers)
