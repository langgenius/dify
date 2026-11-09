"""Compose invocation-local sharing between app replacement rules and model moderation."""

import logging
from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from functools import partial, wraps
from inspect import signature

from configs import dify_config
from core.app.app_config.entities import AppConfig
from core.app.entities.app_invoke_entities import AppGenerateEntity, EasyUIBasedAppGenerateEntity
from core.model_context import get_app_moderation_runtime, use_app_moderation_runtime
from enums import DeploymentEdition
from models.model import App
from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationRejectedInvocationError,
)
from services.moderation_service import ModerationPhase, ModerationRejectedError, ModerationRule, ModerationService
from services.moderation_session import ModerationSession

logger = logging.getLogger(__name__)


class ScopedAppModerationRuntime:
    """Implement the injected app coordination port without exposing service dependencies to the kernel."""

    def __init__(self, session: ModerationSession) -> None:
        """Bind one admitted session without provider I/O or process-wide caching."""
        self.session = session

    def configure(self, entity: AppGenerateEntity) -> None:
        """Activate sharing from trusted app/model configuration while the session is bound."""
        configure_app_moderation(entity)

    def check_openai(
        self, tenant_id: str, app_id: str, inputs: Mapping[str, object], phase: ModerationPhase
    ) -> bool | None:
        """Return the shared verdict, or None when this invocation does not own platform moderation."""
        return check_app_openai(tenant_id, app_id, inputs, phase)

    def output_checker(self, app_config: AppConfig) -> Callable[[str], bool | None] | None:
        """Capture matching output checks for the consumer and its detached moderation worker."""
        return app_output_checker(app_config)

    def replacement(self, app_config: AppConfig, error: Exception) -> tuple[str, str] | None:
        """Preserve an enabled app preset for platform rejection, never for infrastructure errors."""
        if app_config.tenant_id != self.session.tenant_id or app_config.app_id != self.session.app_id:
            return None
        return app_rejection_replacement(app_config, error)

    def workflow_replacement(self, app_config: AppConfig) -> Callable[[str], tuple[str, str] | None]:
        """Capture exact scoped verdict matching before workflow contexts detach."""
        return workflow_rejection_handler(app_config)


@contextmanager
def app_moderation_scope(tenant_id: str, app_id: str) -> Generator[ModerationSession]:
    """Create one isolated scope; copied worker contexts retain it after the caller's context resets."""
    session = ModerationSession(tenant_id, app_id)
    with use_app_moderation_runtime(ScopedAppModerationRuntime(session)):
        yield session


def current_moderation_session(tenant_id: str) -> ModerationSession | None:
    """Return the current session only when its admitted tenant matches."""
    runtime = get_app_moderation_runtime()
    session = runtime.session if isinstance(runtime, ScopedAppModerationRuntime) else None
    return session if session is not None and session.tenant_id == tenant_id else None


def with_app_moderation_scope[**Parameters, ResultT](
    method: Callable[Parameters, ResultT],
) -> Callable[Parameters, ResultT]:
    """Bind scope while constructing app workers and response pipelines, without leaking it to later requests."""

    method_signature = signature(method)

    @wraps(method)
    def wrapped(*args: Parameters.args, **kwargs: Parameters.kwargs) -> ResultT:
        app_model: App = method_signature.bind(*args, **kwargs).arguments["app_model"]
        with app_moderation_scope(app_model.tenant_id, app_model.id):
            return method(*args, **kwargs)

    return wrapped


def check_app_openai(tenant_id: str, app_id: str, inputs: Mapping[str, object], phase: ModerationPhase) -> bool | None:
    """Reuse an active platform route for an app rule; None preserves independent app moderation."""
    session = current_moderation_session(tenant_id)
    if session is None or not session.enabled or session.app_id != app_id:
        return None
    check = build_app_openai_checker(session, phase)
    return any(check(str(value)) for value in inputs.values())


def configure_app_moderation(entity: AppGenerateEntity) -> None:
    """Activate sharing for the trusted main model, or the workflow's explicit app OpenAI rule."""
    from extensions.application_services.moderation import platform_moderation_enabled

    session = current_moderation_session(entity.app_config.tenant_id)
    if session is not None and session.app_id == entity.app_config.app_id:
        if isinstance(entity, EasyUIBasedAppGenerateEntity):
            session.enabled = platform_moderation_enabled(entity.model_conf.provider_model_bundle)
        else:
            rule = entity.app_config.sensitive_word_avoidance
            session.enabled = (
                dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
                and dify_config.HOSTED_MODERATION_ENABLED
                and rule is not None
                and rule.type == "openai_moderation"
            )


def build_app_openai_checker(
    session: ModerationSession, phase: ModerationPhase, *, service: ModerationService | None = None
) -> Callable[[str], bool]:
    """Capture the session for output-worker threads and share only the matching OpenAI capability."""
    from extensions.application_services.moderation import build_platform_moderation_service
    from machinery.context import AppRequestContext

    service = service if service is not None else build_platform_moderation_service()
    context = AppRequestContext(tenant_id=session.tenant_id, app_id=session.app_id)
    rule = ModerationRule(
        type="openai_moderation",
        config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}},
    )

    def check(text: str) -> bool:
        if phase == "output" and session.approved_output(text):
            return False
        try:
            size = dify_config.MODERATION_NON_STREAM_SEGMENT_SIZE
            for start in range(0, len(text), size):
                segment = text[start : start + size]
                session.check(segment, phase, partial(service.check, context, rule=rule, text=segment, phase=phase))
        except ModerationRejectedError:
            return True
        except Exception as error:
            logger.exception(
                "App moderation check failed. tenant_id=%s app_id=%s phase=%s", session.tenant_id, session.app_id, phase
            )
            raise ModerationUnavailableInvocationError() from error
        return False

    return check


def app_output_checker(app_config: AppConfig) -> Callable[[str], bool | None] | None:
    """Capture an active scope for the app output worker; unrelated backends retain their own checks."""
    session = current_moderation_session(app_config.tenant_id)
    rule = app_config.sensitive_word_avoidance
    if session is None or session.app_id != app_config.app_id or rule is None or rule.type != "openai_moderation":
        return None
    checker: Callable[[str], bool] | None = None

    def check(text: str) -> bool | None:
        nonlocal checker
        if not session.enabled:
            return None
        if checker is None:
            checker = build_app_openai_checker(session, "output")
        return checker(text)

    return check


def app_rejection_replacement(app_config: AppConfig, error: Exception) -> tuple[str, str] | None:
    """Apply an enabled app OpenAI preset only to a platform rejection, never service unavailability."""
    if not isinstance(error, PlatformModerationRejectedInvocationError):
        return None
    rule = app_config.sensitive_word_avoidance
    if rule is None or rule.type != "openai_moderation":
        return None
    config = rule.config.get(f"{error.phase}s_config")
    if not isinstance(config, dict) or config.get("enabled") is not True:
        return None
    response = config.get("preset_response")
    return (response, error.phase) if isinstance(response, str) else None


def workflow_rejection_handler(app_config: AppConfig) -> Callable[[str], tuple[str, str] | None]:
    """Capture invocation-local verdicts before worker contexts detach; match exact terminal workflow errors only."""
    session = current_moderation_session(app_config.tenant_id)
    if session is not None and session.app_id != app_config.app_id:
        session = None

    def replacement(message: str) -> tuple[str, str] | None:
        phase = session.rejected_phase(message) if session is not None else None
        if phase is None:
            return None
        return app_rejection_replacement(app_config, PlatformModerationRejectedInvocationError(phase, message))

    return replacement
