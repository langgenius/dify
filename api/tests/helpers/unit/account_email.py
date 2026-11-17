"""In-memory external email transports; tests retain the real state machine and database."""

from dataclasses import dataclass, field
from uuid import uuid4

from services.entities.account_entities import AccountChangeEmailPhase, AccountChangeEmailTokenData


@dataclass
class AccountEmailTransports:
    tokens: dict[str, AccountChangeEmailTokenData] = field(default_factory=dict)
    sent: list[tuple[str, str, str, AccountChangeEmailPhase]] = field(default_factory=list)
    completed: list[str] = field(default_factory=list)
    failures: dict[str, int] = field(default_factory=dict)
    sends: dict[str, int] = field(default_factory=dict)
    frozen: dict[str, str] = field(default_factory=dict)
    ip_limited: bool = False
    retry_after_minutes: int = 1

    def get(self, token: str) -> AccountChangeEmailTokenData | None:
        return self.tokens.get(token)

    def issue(self, token_data: AccountChangeEmailTokenData) -> str:
        token = str(uuid4())
        self.tokens[token] = token_data
        return token

    def revoke(self, token: str) -> None:
        self.tokens.pop(token, None)

    def send_code(self, *, email: str, code: str, language: str, phase: AccountChangeEmailPhase) -> None:
        self.sent.append((email, code, language, phase))

    def send_completed(self, *, email: str, language: str) -> None:
        self.completed.append(email)

    def is_limited(self, email: str) -> bool:
        return self.sends.get(email, 0) >= 3

    def record(self, email: str) -> None:
        self.sends[email] = self.sends.get(email, 0) + 1

    def is_ip_limited(self, ip_address: str) -> bool:
        return self.ip_limited

    def is_verification_limited(self, email: str) -> bool:
        return self.failures.get(email, 0) >= 5

    def record_verification_failure(self, email: str) -> None:
        self.failures[email] = self.failures.get(email, 0) + 1

    def reset_verification_failures(self, email: str) -> None:
        self.failures.pop(email, None)

    def is_frozen(self, email: str) -> str | None:
        return self.frozen.get(email)
