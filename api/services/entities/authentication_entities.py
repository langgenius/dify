"""Framework-neutral contracts shared by authentication use cases."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class StoredAuthenticationToken:
    email: str | None
    code: str | None
    phase: str | None = None


@dataclass(frozen=True, slots=True)
class WebAppSessionRecord:
    end_user_session_id: str


@dataclass(frozen=True, slots=True)
class WebLoginStatus:
    logged_in: bool
    app_logged_in: bool
