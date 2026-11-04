"""Composition for generic moderation policies bound during model assembly."""

from sqlalchemy.orm import Session, sessionmaker

from machinery.context import AppRequestContext
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_adapters import WorkspaceTokenCipher
from services.moderation_adapters import ExtensionModerationGateway, LLMModerationGuard
from services.moderation_service import ModerationPhase, ModerationRule, ModerationService


def build_moderation_service(*, database_client: sessionmaker[Session]) -> ModerationService:
    """Wire the three registered legacy moderation backends without performing I/O."""
    return ModerationService(
        gateway=ExtensionModerationGateway(
            extensions=APIBasedExtensionRepository(session_factory=database_client), cipher=WorkspaceTokenCipher()
        )
    )


def build_llm_moderation_guard(
    context: AppRequestContext, *, service: ModerationService, rule: ModerationRule
) -> LLMModerationGuard:
    """Bind an admitted scope and snapshot of a rule for model assembly.

    Missing or malformed phase enablement fails during assembly. Disabled phases
    do not inspect content, and disabled output moderation preserves live streaming.
    """
    rule = rule.model_copy(deep=True)
    inputs = rule.config.get("inputs_config")
    if not isinstance(inputs, dict) or not isinstance(inputs.get("enabled"), bool):
        raise ValueError("inputs_config.enabled must be a bool")
    outputs = rule.config.get("outputs_config")
    if not isinstance(outputs, dict) or not isinstance(outputs.get("enabled"), bool):
        raise ValueError("outputs_config.enabled must be a bool")

    def check(text: str, phase: ModerationPhase) -> None:
        """Apply the bound rule through the application use case for a runtime phase."""
        service.check(context, rule=rule, text=text, phase=phase)

    return LLMModerationGuard(
        tenant_id=context.tenant_id, check=check, check_input=inputs["enabled"], check_output=outputs["enabled"]
    )
