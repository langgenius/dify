"""Explicit Guest credential ownership transfer after Account authentication."""

from dataclasses import dataclass
from typing import Protocol

from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionAccountRequiredError, ConnectionIdentityError
from services.web_passport_service import WebPassportService, WebPassportTokenGateway


class ConnectionClaimStore(Protocol):
    def claim_connections(self, guest: WebConnectionContext, *, account_end_user_id: str) -> int: ...


@dataclass(frozen=True)
class ConnectionClaimResult:
    access_token: str
    claimed_connections: int


class ConnectionClaimService:
    def __init__(
        self, *, store: ConnectionClaimStore, passports: WebPassportService, tokens: WebPassportTokenGateway
    ) -> None:
        self._store = store
        self._passports = passports
        self._tokens = tokens

    def claim(self, guest: WebConnectionContext, *, app_code: str, access_token: str) -> ConnectionClaimResult:
        if guest.account_id is not None:
            raise ConnectionIdentityError()
        if not access_token or self._tokens.verify(access_token).get("token_source") != "webapp_account_login":
            raise ConnectionAccountRequiredError()
        passport = self._passports.issue_for_account(app_code=app_code, access_token=access_token)
        # Reuse Passport authentication and Enterprise admission. The new token
        # identifies the target without accepting an Account/EndUser ID from the caller.
        claims = self._tokens.verify(passport.access_token)
        target_id = claims.get("end_user_id")
        if claims.get("app_id") != guest.app_id or not isinstance(target_id, str):
            raise ConnectionIdentityError()
        count = self._store.claim_connections(guest, account_end_user_id=target_id)
        return ConnectionClaimResult(access_token=passport.access_token, claimed_connections=count)
