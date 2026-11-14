"""Reuse Composer validation for Build without retaining a session across enterprise calls."""

from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.agent_config_entities import AgentSoulConfig
from models.agent_soul_state import backfill_cli_tool_ids
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import AgentSoulLockedError, InvalidComposerConfigError, PlaintextSecretNotAllowedError
from services.agent.knowledge_datasets import list_missing_tenant_knowledge_dataset_ids
from services.agent.knowledge_spaces import read_agent_knowledge_space_roles, require_agent_knowledge_space_access
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
        """Normalize and validate the supplied draft Soul, retaining omitted fields for persistence."""
        soul = payload.agent_soul
        if soul is None:
            raise ValueError("agent_soul is required")
        backfill_cli_tool_ids(soul)
        try:
            ComposerConfigValidator.validate_draft_save_payload(payload)
            self._validate_knowledge(context, soul, check_datasets=False)
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
            self._validate_knowledge(context, soul, check_datasets=True)
        except InvalidComposerConfigError as exc:
            raise AgentBuildInvalidConfigError(exc.description) from exc
        except PlaintextSecretNotAllowedError as exc:
            raise AgentBuildPlaintextSecretError(exc.description) from exc

    def _validate_knowledge(self, context: RequestContext, soul: AgentSoulConfig, *, check_datasets: bool) -> None:
        """Resolve local knowledge facts before asking Enterprise to authorize spaces."""
        tenant_id = context.active_workspace_id
        account_id = context.account_id
        ids = [binding.control_space_id for binding in soul.knowledge.spaces if not binding.is_missing]
        if check_datasets or ids:
            with self._session_factory() as session:
                if check_datasets:
                    missing = list_missing_tenant_knowledge_dataset_ids(
                        session=session, tenant_id=tenant_id, agent_soul=soul
                    )
                    if missing:
                        raise InvalidComposerConfigError(
                            "knowledge_dataset_not_found: knowledge sets reference missing or out-of-scope datasets: "
                            + ", ".join(missing)
                        )
                roles = (
                    read_agent_knowledge_space_roles(session, tenant_id=tenant_id, account_id=account_id, ids=ids)
                    if ids
                    else {}
                )
            if ids:
                require_agent_knowledge_space_access(tenant_id=tenant_id, account_id=account_id, ids=ids, roles=roles)
