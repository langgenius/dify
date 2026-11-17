"""Standalone Agent Composer operations with session-free validation and tool discovery."""

from dataclasses import dataclass
from typing import Protocol

from machinery.context import RequestContext
from models.agent_config_entities import AgentSoulConfig
from models.agent_knowledge import list_agent_soul_knowledge_dataset_ids
from models.agent_soul_state import backfill_cli_tool_ids
from services.agent.app_composer_store import AgentAppComposerStore, AgentComposerState
from services.agent.composer_candidates import soul_candidates
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.errors import InvalidComposerConfigError
from services.entities.agent_entities import (
    ComposerCandidatesResponse,
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerVariant,
)


class ComposerKnowledgeAuthorization(Protocol):
    def __call__(self, *, tenant_id: str, account_id: str, soul: AgentSoulConfig) -> None:
        """Authorize the account to read and query each configured knowledge space."""
        ...


class ComposerWorkspaceTools(Protocol):
    def __call__(self, *, tenant_id: str, user_id: str) -> list[dict[str, object]]:
        """List workspace plugin tool candidates, with an empty list on provider outage."""
        ...


@dataclass(frozen=True, slots=True)
class AgentComposerSaveResult:
    state: AgentComposerState
    validation: dict[str, object]


class AgentAppComposer:
    """Operate on the shared draft within the workspace admitted by the caller."""

    def __init__(
        self,
        *,
        store: AgentAppComposerStore,
        authorize_knowledge: ComposerKnowledgeAuthorization,
        workspace_tools: ComposerWorkspaceTools,
    ) -> None:
        """Accept a store that detaches results and integrations callable after it closes its session."""
        self._store = store
        self._authorize_knowledge = authorize_knowledge
        self._workspace_tools = workspace_tools

    def get(self, context: RequestContext, agent_id: str) -> AgentComposerState:
        """Read the requested Agent's effective configuration without creating a draft."""
        return self._store.get_composer(tenant_id=context.active_workspace_id, agent_id=agent_id)

    def save(self, context: RequestContext, agent_id: str, payload: ComposerSavePayload) -> AgentComposerSaveResult:
        """Validate the requested normal-draft save before writing the shared draft."""
        if payload.variant != ComposerVariant.AGENT_APP:
            raise ValueError("Agent composer endpoint only accepts agent_app variant")
        if payload.save_strategy != ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION:
            raise InvalidComposerConfigError(
                "Agent composer only saves the normal draft. Use the publish endpoint to create a version."
            )
        soul = payload.agent_soul
        if soul is None:
            raise ValueError("agent_soul is required")
        backfill_cli_tool_ids(soul)
        ComposerConfigValidator.validate_draft_save_payload(payload)
        self._authorize_knowledge(tenant_id=context.active_workspace_id, account_id=context.account_id, soul=soul)
        validation = composer_validation_findings(payload)
        state = self._store.save_composer(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id, soul=soul
        )
        return AgentComposerSaveResult(state, validation)

    def validate(self, context: RequestContext, agent_id: str, payload: ComposerSavePayload) -> dict[str, object]:
        """Require readable Composer state and validate publish rules without persisting changes."""
        self.get(context, agent_id)
        ComposerConfigValidator.validate_publish_payload(payload)
        if payload.agent_soul is not None:
            ids = list_agent_soul_knowledge_dataset_ids(payload.agent_soul)
            missing = (
                self._store.missing_composer_datasets(tenant_id=context.active_workspace_id, dataset_ids=ids)
                if ids
                else []
            )
            if missing:
                raise InvalidComposerConfigError(
                    "knowledge_dataset_not_found: knowledge sets reference missing or out-of-scope datasets: "
                    + ", ".join(missing)
                )
        return {"result": "success", "errors": [], **composer_validation_findings(payload)}

    def candidates(self, context: RequestContext, agent_id: str) -> ComposerCandidatesResponse:
        """Combine detached dataset and Soul data with workspace tools outside the read session."""
        source = self._store.get_composer_candidates(tenant_id=context.active_workspace_id, agent_id=agent_id)
        lists, truncated = soul_candidates(
            agent_soul=source.soul,
            dataset_lookup=lambda ids: source.datasets,
            workspace_tools_loader=lambda: self._workspace_tools(
                tenant_id=context.active_workspace_id, user_id=context.account_id
            ),
        )
        return ComposerCandidatesResponse(
            variant=ComposerVariant.AGENT_APP,
            allowed_soul_candidates=lists,
            truncated=truncated,
        )


def composer_validation_findings(payload: ComposerSavePayload) -> dict[str, object]:
    """Report nonblocking mention findings for the supplied configuration."""
    soul = payload.agent_soul
    ids = {binding.id for binding in (*soul.knowledge.sets, *soul.knowledge.spaces)} if soul else None
    return ComposerConfigValidator.collect_soft_findings(payload, existing_knowledge_set_ids=ids)
