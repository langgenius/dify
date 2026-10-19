"""Validate login identities without requiring workspace membership.

Account IDs stay inside this boundary and persistence. App Passports only expose
the corresponding EndUser ID, which is also used by existing runtime resources.
"""

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from services.account_ports import AccountSnapshotQuery
from services.entities.passport_entities import WebAppLoginClaims


class WebIdentityError(Exception):
    pass


class WebIdentityService:
    def __init__(self, *, accounts: AccountSnapshotQuery, allow_console_login: bool, allow_webapp_login: bool) -> None:
        self._accounts = accounts
        self._allow_console_login = allow_console_login
        self._allow_webapp_login = allow_webapp_login

    def resolve_login(self, decoded: Mapping[str, Any]) -> WebAppLoginClaims:
        try:
            claims = WebAppLoginClaims.model_validate(decoded)
        except ValidationError as exc:
            raise WebIdentityError("Invalid login token.") from exc
        if claims.token_source is None:
            if not self._allow_console_login or claims.sub != "Console API Passport":
                raise WebIdentityError("Invalid login token source.")
        elif claims.token_source == "webapp_login_token":
            if (
                not self._allow_webapp_login
                or claims.sub != "Web API Passport"
                or claims.auth_type not in {"internal", "external"}
            ):
                raise WebIdentityError("Invalid web app login token.")
        else:
            raise WebIdentityError("Invalid login token source.")
        if not claims.user_id or not claims.exp or claims.exp <= 0:
            raise WebIdentityError("Missing login identity or expiration.")
        if claims.token_source is None and claims.account_id is not None:
            self.require_account(claims.account_id)
        return claims

    def require_account(self, account_id: str) -> None:
        try:
            UUID(account_id)
        except ValueError as exc:
            raise WebIdentityError("Invalid account identity.") from exc
        account = self._accounts.get(account_id)
        if account is None or account.status not in {"active", "uninitialized"}:
            raise WebIdentityError("Account is unavailable.")

    def validate_passport(self, decoded: Mapping[str, Any], *, account_id: str | None) -> None:
        if decoded.get("sub") != "Web API Passport":
            raise WebIdentityError("Invalid Passport purpose.")
        source = decoded.get("token_source")
        if account_id is not None:
            if source != "webapp_account" or not isinstance(decoded.get("exp"), int):
                raise WebIdentityError("Account Passport required.")
            self.require_account(account_id)
        elif source == "webapp_account":
            raise WebIdentityError("Account Passport has no account mapping.")
        elif source not in {None, "webapp"}:
            raise WebIdentityError("Invalid Passport source.")
