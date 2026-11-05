"""Strict, reusable moderation independent of app response-replacement policies.

Every flagged verdict rejects the original content, including override verdicts.
Backend failures propagate: unavailable moderation must never imply approval.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict

from machinery.context import AppRequestContext

type ModerationPhase = Literal["input", "output"]


class ModerationRule(BaseModel):
    """Validated backend selection using the existing moderation configuration format."""

    model_config = ConfigDict(frozen=True)

    type: Literal["keywords", "openai_moderation", "api"]
    config: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ModerationVerdict:
    flagged: bool
    message: str


class ModerationGateway(Protocol):
    """Evaluate content in the supplied tenant scope through an explicit credential boundary.

    Tenant-backed adapters use only that tenant's extension/model credentials.
    Platform-funded adapters use platform credentials and never reserve or deduct
    user credits. All adapters propagate lookup, transport, and malformed-verdict
    failures. No persistence transaction spans external I/O.
    """

    def check(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        text: str,
        phase: ModerationPhase,
    ) -> ModerationVerdict: ...


class ModerationRejectedError(Exception):
    """The original content cannot be delivered, regardless of a backend's replacement action."""

    def __init__(self, phase: ModerationPhase, message: str) -> None:
        """Preserve the rejected phase and expose the backend message without rejected content."""
        self.phase = phase
        super().__init__(message or f"Model {phase} was rejected by moderation.")


class ModerationService:
    def __init__(self, *, gateway: ModerationGateway) -> None:
        """Receive the configured backend gateway; construction performs no external I/O."""
        self._gateway = gateway

    def check(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        text: str,
        phase: ModerationPhase,
    ) -> None:
        """Check text in an admitted tenant/app scope without modifying it.

        Enabled checks return only after approval; flagged content raises
        ModerationRejectedError, and backend errors propagate unchanged. Disabled
        phases perform no external I/O. A missing tenant is never admitted.
        """
        if not context.tenant_id:
            raise ValueError("Moderation requires a tenant scope.")
        phase_config = rule.config.get(f"{phase}s_config")
        if not isinstance(phase_config, Mapping) or not isinstance(phase_config.get("enabled"), bool):
            raise ValueError(f"{phase}s_config.enabled must be a bool")
        if not phase_config["enabled"]:
            return
        verdict = self._gateway.check(context, rule=rule, text=text, phase=phase)
        if verdict.flagged:
            raise ModerationRejectedError(phase, verdict.message)
