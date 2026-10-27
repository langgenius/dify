"""Explicit Guest credential ownership transfer after Account authentication."""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionConflictError, ConnectionError, ConnectionIdentityError
from services.web_identity_service import WebIdentityError, WebIdentityService
from services.web_passport_service import (
    WebPassportAccessDeniedError,
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportService,
    WebPassportTokenGateway,
    WebPassportUnauthorizedError,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ConnectionClaimSource:
    context: WebConnectionContext
    app_code: str
    app_name: str
    connection_count: int


class ConnectionClaimStore(Protocol):
    def get_claim_source(self, *, app_code: str, app_id: str, end_user_id: str) -> ConnectionClaimSource | None: ...

    def claim_connections(self, guest: WebConnectionContext, *, account_end_user_id: str) -> int: ...


@dataclass(frozen=True)
class ConnectionClaimResult:
    index: int
    app_code: str
    access_token: str
    claimed_connections: int


class ConnectionClaimUnavailableError(ConnectionError):
    def __init__(self) -> None:
        super().__init__("Connection claim is temporarily unavailable. Please retry.")


@dataclass(frozen=True)
class ConnectionClaimFailure:
    index: int
    error: (
        ConnectionIdentityError
        | ConnectionConflictError
        | ConnectionClaimUnavailableError
        | WebPassportUnauthorizedError
        | WebPassportNotFoundError
        | WebPassportAuthenticationRequiredError
        | WebPassportAccessDeniedError
    )


class ConnectionClaimPreflightError(ConnectionError):
    def __init__(self, failures: Sequence[ConnectionClaimFailure]) -> None:
        super().__init__("Connection claim preflight failed. No Connections were transferred.")
        self.failures = tuple(failures)


class ConnectionClaimService:
    def __init__(
        self,
        *,
        store: ConnectionClaimStore,
        passports: WebPassportService,
        tokens: WebPassportTokenGateway,
        identities: WebIdentityService,
    ) -> None:
        self._store = store
        self._passports = passports
        self._tokens = tokens
        self._identities = identities

    def _source(self, passport: str) -> ConnectionClaimSource:
        try:
            claims = self._tokens.verify(passport)
        except WebPassportUnauthorizedError as exc:
            raise ConnectionIdentityError() from exc
        # Account and Enterprise SSO Passports are not anonymous browser identities.
        if claims.get("sub") != "Web API Passport" or claims.get("token_source") is not None:
            raise ConnectionIdentityError()
        app_code, app_id, end_user_id = (claims.get(key) for key in ("app_code", "app_id", "end_user_id"))
        if not isinstance(app_code, str) or not app_code:
            raise ConnectionIdentityError()
        if not isinstance(app_id, str) or not isinstance(end_user_id, str):
            raise ConnectionIdentityError()
        try:
            UUID(app_id)
            UUID(end_user_id)
        except ValueError as exc:
            raise ConnectionIdentityError() from exc
        source = self._store.get_claim_source(app_code=app_code, app_id=app_id, end_user_id=end_user_id)
        if source is None:
            raise WebPassportNotFoundError()
        return source

    def claimable_passports(self, passports: Sequence[str]) -> list[tuple[int, ConnectionClaimSource]]:
        result: list[tuple[int, ConnectionClaimSource]] = []
        seen: set[WebConnectionContext] = set()
        for index, passport in enumerate(passports):
            try:
                source = self._source(passport)
            except (ConnectionIdentityError, WebPassportNotFoundError):
                continue
            if source.context in seen or source.connection_count == 0:
                continue
            seen.add(source.context)
            result.append((index, source))
        return result

    def claim(
        self, passports: Sequence[str], *, access_token: str
    ) -> list[ConnectionClaimResult | ConnectionClaimFailure]:
        # Authenticate the shared Account before any item can change ownership.
        try:
            identity = self._identities.resolve_login(self._tokens.verify(access_token))
        except WebIdentityError as exc:
            raise WebPassportUnauthorizedError("Account login required.") from exc
        if identity.token_source != "webapp_account_login" or identity.account_id is None:
            raise WebPassportUnauthorizedError("Account Web login required.")
        sources: list[tuple[int, ConnectionClaimSource]] = []
        failures: list[ConnectionClaimFailure] = []
        for index, token in enumerate(passports):
            try:
                source = self._source(token)
                self._passports.authorize_account(app_code=source.app_code, access_token=access_token)
                sources.append((index, source))
            except (
                ConnectionIdentityError,
                WebPassportUnauthorizedError,
                WebPassportNotFoundError,
                WebPassportAuthenticationRequiredError,
                WebPassportAccessDeniedError,
            ) as exc:
                failures.append(ConnectionClaimFailure(index, exc))
            except Exception as exc:
                logger.exception("Connection Claim preflight failed for candidate %s", index)
                raise ConnectionClaimUnavailableError() from exc
        if failures:
            raise ConnectionClaimPreflightError(failures)

        results: list[ConnectionClaimResult | ConnectionClaimFailure] = []
        for index, source in sources:
            try:
                # Preflight is advisory across transactions; recheck expiry and current App admission.
                self._tokens.verify(passports[index])
                passport = self._passports.issue_for_account(app_code=source.app_code, access_token=access_token)
                claims = self._tokens.verify(passport.access_token)
                target_id = claims.get("end_user_id")
                if claims.get("app_id") != source.context.app_id or not isinstance(target_id, str):
                    raise ConnectionIdentityError()
                count = self._store.claim_connections(source.context, account_end_user_id=target_id)
                results.append(ConnectionClaimResult(index, source.app_code, passport.access_token, count))
            except (
                ConnectionIdentityError,
                ConnectionConflictError,
                WebPassportUnauthorizedError,
                WebPassportNotFoundError,
                WebPassportAuthenticationRequiredError,
                WebPassportAccessDeniedError,
            ) as exc:
                results.append(ConnectionClaimFailure(index, exc))
            except Exception:
                # A failed item must not discard results of independently committed items.
                logger.exception("Connection Claim failed for candidate %s", index)
                results.append(ConnectionClaimFailure(index, ConnectionClaimUnavailableError()))
        return results
