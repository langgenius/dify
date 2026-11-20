"""Reuse Composer validation for Build without retaining a session across enterprise calls."""

from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.agent_config_entities import AgentSoulConfig
from models.agent_soul_state import backfill_cli_tool_ids
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import AgentSoulLockedError, InvalidComposerConfigError, PlaintextSecretNotAllowedError
from services.agent.knowledge_spaces import authorize_composer_knowledge
from services.app.agent_build_session_store import (
    AgentBuildInvalidConfigError,
    AgentBuildPlaintextSecretError,
    AgentBuildSoulLockedError,
)
from services.entities.agent_entities import ComposerSavePayload, ComposerSaveStrategy, ComposerVariant


class AgentBuildConfigGateway:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        """Use short read sessions to validate workspace-owned knowledge references."""
        self._session_factory = session_factory

    def prepare_save(self, context: RequestContext, payload: ComposerSavePayload) -> dict[str, object]:
        """Require and validate a draft Soul, retaining omitted fields for persistence."""
        soul = payload.agent_soul
        if soul is None:
            raise AgentBuildInvalidConfigError("agent_soul is required")
        backfill_cli_tool_ids(soul)
        try:
            ComposerConfigValidator.validate_draft_save_payload(payload)
            authorize_composer_knowledge(
                session_factory=self._session_factory,
                tenant_id=context.active_workspace_id,
                account_id=context.account_id,
                soul=soul,
            )
        except AgentSoulLockedError as exc:
            raise AgentBuildSoulLockedError(exc.description) from exc
        except InvalidComposerConfigError as exc:
            raise AgentBuildInvalidConfigError(exc.description) from exc
        exclude = set() if "config_files" in soul.model_fields_set else {"config_files"}
        return soul.model_dump(mode="json", exclude=exclude)

    def validate_apply(self, context: RequestContext, agent_soul: dict[str, object]) -> None:
        """Validate the detached Soul with publish rules and authorize all of its knowledge references."""
        soul = AgentSoulConfig.model_validate(agent_soul)
        try:
            ComposerConfigValidator.validate_publish_payload(
                ComposerSavePayload(
                    variant=ComposerVariant.AGENT_APP,
                    agent_soul=soul,
                    save_strategy=ComposerSaveStrategy.SAVE_AS_NEW_VERSION,
                )
            )
            authorize_composer_knowledge(
                session_factory=self._session_factory,
                tenant_id=context.active_workspace_id,
                account_id=context.account_id,
                soul=soul,
                check_datasets=True,
            )
        except InvalidComposerConfigError as exc:
            raise AgentBuildInvalidConfigError(exc.description) from exc
        except PlaintextSecretNotAllowedError as exc:
            raise AgentBuildPlaintextSecretError(exc.description) from exc
