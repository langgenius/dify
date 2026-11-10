"""Reusable moderation checks for model invocation and app-level replacement rules.

``check`` applies strict rejection for model invocation. ``evaluate`` exposes the
backend verdict, including app replacement data, to the app pipeline. Every
flagged verdict remains flagged even when a backend requests overriding content;
only the app pipeline may apply that replacement. Backend failures propagate:
unavailable moderation must never imply approval.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict

from machinery.context import AppRequestContext

type ModerationPhase = Literal["input", "output"]
type ModerationAction = Literal["direct_output", "overridden"]


class ModerationRule(BaseModel):
    """Validated backend selection using the existing moderation configuration format."""

    model_config = ConfigDict(frozen=True)

    type: Literal["keywords", "openai_moderation", "api"]
    config: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ModerationRequest:
    """Content and app-shaped fields supplied to one moderation backend.

    ``inputs=None`` identifies a generic text request. An app request supplies
    a mapping (possibly empty) and a query, preserving the legacy input contract.
    """

    text: str
    inputs: Mapping[str, Any] | None = None
    query: str = ""


@dataclass(frozen=True, slots=True)
class ModerationReplacement:
    """The app-level replacement semantics returned by a legacy moderation backend."""

    action: ModerationAction
    preset_response: str = ""
    inputs: Mapping[str, Any] = field(default_factory=dict)
    query: str = ""
    text: str = ""


@dataclass(frozen=True, slots=True)
class ModerationVerdict:
    flagged: bool
    message: str
    replacement: ModerationReplacement | None = None


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
        request: ModerationRequest,
        phase: ModerationPhase,
    ) -> ModerationVerdict: ...


class ModerationError(Exception):
    """Base contract for terminal moderation failures, independent of model invocation and transport."""


class ModerationRejectedError(ModerationError):
    """The original content cannot be delivered, regardless of a backend's replacement action."""

    def __init__(self, phase: ModerationPhase, message: str) -> None:
        """Preserve the rejected phase and expose the backend message without rejected content."""
        self.phase = phase
        super().__init__(message or f"Model {phase} was rejected by moderation.")


class ModerationUnavailableError(ModerationError):
    """A moderation backend could not evaluate content; callers must not substitute approval or fallback results."""


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
        verdict = self.evaluate(
            context,
            rule=rule,
            request=ModerationRequest(text=text),
            phase=phase,
        )
        if verdict.flagged:
            raise ModerationRejectedError(phase, verdict.message)

    def evaluate(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        request: ModerationRequest,
        phase: ModerationPhase,
    ) -> ModerationVerdict:
        """Return a backend verdict, including app replacement data, without applying it.

        The gateway is called only for enabled phases. Missing tenant scope and
        invalid enablement fail closed. A flagged verdict remains flagged even
        when its backend requests overriding content.
        """
        if not context.tenant_id:
            raise ValueError("Moderation requires a tenant scope.")
        phase_config = rule.config.get(f"{phase}s_config")
        if not isinstance(phase_config, Mapping) or not isinstance(phase_config.get("enabled"), bool):
            raise ValueError(f"{phase}s_config.enabled must be a bool")
        if not phase_config["enabled"]:
            return ModerationVerdict(flagged=False, message="")
        return self._gateway.check(context, rule=rule, request=request, phase=phase)
