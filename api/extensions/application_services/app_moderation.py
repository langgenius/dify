"""Evaluate app rules and render direct-generation model failures without invocation-local state."""

import logging
from collections.abc import Callable, Mapping

from core.app.app_config.entities import AppConfig, SensitiveWordAvoidanceEntity
from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from machinery.context import AppRequestContext
from models.model import AppMode
from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationRejectedInvocationError,
)
from services.moderation_service import (
    ModerationPhase,
    ModerationRequest,
    ModerationRule,
    ModerationService,
    ModerationVerdict,
)

logger = logging.getLogger(__name__)

DEFAULT_CHAT_MODERATION_REPLY = "This message can’t be processed."


def _app_service() -> ModerationService:
    """Resolve the shared use case only when a keyword or API app check actually runs."""
    from extensions.ext_application_services import application_services

    return application_services().moderation


def _inputs_result_from_verdict(
    verdict: ModerationVerdict, inputs: Mapping[str, object], query: str
) -> ModerationInputsResult:
    """Adapt the use-case verdict to the legacy input result expected by app tracing and replacement."""
    replacement = verdict.replacement
    if replacement is not None and replacement.action == "overridden":
        return ModerationInputsResult(
            flagged=verdict.flagged,
            action=ModerationAction.OVERRIDDEN,
            preset_response=replacement.preset_response,
            inputs=dict(replacement.inputs),
            query=replacement.query,
        )
    return ModerationInputsResult(
        flagged=verdict.flagged,
        action=ModerationAction.DIRECT_OUTPUT,
        preset_response=replacement.preset_response if replacement is not None else verdict.message,
        inputs=dict(inputs),
        query=query,
    )


def _outputs_result_from_verdict(verdict: ModerationVerdict) -> ModerationOutputsResult:
    """Adapt the use-case verdict to the legacy output result expected by the delivery pipeline."""
    replacement = verdict.replacement
    action = (
        ModerationAction.OVERRIDDEN
        if replacement is not None and replacement.action == "overridden"
        else ModerationAction.DIRECT_OUTPUT
    )
    return ModerationOutputsResult(
        flagged=verdict.flagged,
        action=action,
        preset_response=replacement.preset_response if replacement is not None else verdict.message,
        text=replacement.text if replacement is not None else "",
    )


def _phase_enabled(rule: SensitiveWordAvoidanceEntity, phase: ModerationPhase) -> bool:
    """Validate app phase configuration once before choosing the execution path."""
    config = rule.config.get(f"{phase}s_config")
    if not isinstance(config, dict) or not isinstance(config.get("enabled"), bool):
        raise ValueError(f"{phase}s_config.enabled must be a bool")
    return config["enabled"]


def _app_rule(rule: SensitiveWordAvoidanceEntity) -> ModerationRule:
    """Convert trusted app configuration to the use-case rule without changing its payload."""
    return ModerationRule.model_validate({"type": rule.type, "config": rule.config})


def evaluate_app_input(
    app_config: AppConfig, inputs: Mapping[str, object], query: str, *, platform_owned: bool
) -> ModerationInputsResult | None:
    """Evaluate an admitted app rule, exposing backend failures only as safe unavailable errors.

    Disabled phases perform no backend I/O. When platform guards own this
    invocation's OpenAI checks, an OpenAI app rule performs no backend I/O and
    only supplies replacement text. Keyword, API, and tenant-owned OpenAI
    failures retain their private cause in logs and never become approvals or
    preset replies.
    """
    rule = app_config.sensitive_word_avoidance
    if rule is None:
        return None
    if not _phase_enabled(rule, "input") or (rule.type == "openai_moderation" and platform_owned):
        return ModerationInputsResult(
            flagged=False,
            action=ModerationAction.DIRECT_OUTPUT,
            inputs=dict(inputs),
            query=query,
        )
    try:
        verdict = _app_service().evaluate(
            AppRequestContext(tenant_id=app_config.tenant_id, app_id=app_config.app_id),
            rule=_app_rule(rule),
            request=ModerationRequest(text="", inputs=dict(inputs), query=query),
            phase="input",
        )
    except ModerationUnavailableInvocationError:
        raise
    except Exception as error:
        logger.exception("App input moderation failed. tenant_id=%s app_id=%s", app_config.tenant_id, app_config.app_id)
        raise ModerationUnavailableInvocationError() from error
    return _inputs_result_from_verdict(verdict, inputs, query)


def app_output_evaluator(
    app_config: AppConfig, *, platform_owned: bool
) -> Callable[[str], ModerationOutputsResult | None] | None:
    """Capture an admitted app rule and adapt output failures to a safe invocation error.

    When platform guards own this invocation's OpenAI checks, an OpenAI rule
    receives no evaluator. Backend and configuration failures are never
    approvals or preset replies; provider diagnostics remain in logs only.
    """
    rule = app_config.sensitive_word_avoidance
    if rule is None or (rule.type == "openai_moderation" and platform_owned):
        return None

    def evaluate(text: str) -> ModerationOutputsResult | None:
        """Evaluate the captured app rule and preserve its verdict or safe failure classification."""
        try:
            if not _phase_enabled(rule, "output"):
                return ModerationOutputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)
            verdict = _app_service().evaluate(
                AppRequestContext(tenant_id=app_config.tenant_id, app_id=app_config.app_id),
                rule=_app_rule(rule),
                request=ModerationRequest(text=text),
                phase="output",
            )
            return _outputs_result_from_verdict(verdict)
        except ModerationUnavailableInvocationError:
            raise
        except Exception as error:
            logger.exception(
                "App output moderation failed. tenant_id=%s app_id=%s", app_config.tenant_id, app_config.app_id
            )
            raise ModerationUnavailableInvocationError() from error

    return evaluate


def app_rejection_replacement(app_config: AppConfig, error: Exception) -> tuple[str, str] | None:
    """Prefer an enabled OpenAI preset; use an English chat default for other platform rejections.

    Defaults apply only to Chatbot and legacy Agent Chat. Other modes
    invocations retain their error unless they already have a matching preset.
    Unavailable services and explicit non-platform policy errors never become replies.
    """
    if not isinstance(error, PlatformModerationRejectedInvocationError):
        return None
    response = _platform_rejection_response(app_config, error.phase)
    return (response, error.phase) if response is not None else None


def _platform_rejection_response(app_config: AppConfig, phase: ModerationPhase) -> str | None:
    """Resolve one trusted platform verdict to its nonblank preset or chat fallback without changing configuration."""
    rule = app_config.sensitive_word_avoidance
    if rule is not None and rule.type == "openai_moderation":
        config = rule.config.get(f"{phase}s_config")
        if isinstance(config, dict) and config.get("enabled") is True:
            response = config.get("preset_response")
            if isinstance(response, str) and response.strip():
                return response
    if app_config.app_mode in {AppMode.CHAT, AppMode.AGENT_CHAT}:
        return DEFAULT_CHAT_MODERATION_REPLY
    return None


class AppModeration:
    """Expose stateless app adapters through the kernel's injected policy port, without invocation state."""

    evaluate_input = staticmethod(evaluate_app_input)
    output_evaluator = staticmethod(app_output_evaluator)
    replacement = staticmethod(app_rejection_replacement)
