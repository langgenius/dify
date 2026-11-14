"""Manage an account's Agent Build conversation and draft."""

from typing import Protocol

from machinery.context import RequestContext
from services.app.agent_build_session_store import (
    AgentBuildApplyChangedError,
    AgentBuildBaseUnavailableError,
    AgentBuildBindingUnavailableError,
    AgentBuildDraft,
    AgentBuildHomeSnapshot,
    AgentBuildSandbox,
    AgentBuildSessionStore,
    AgentDraftSummary,
)
from services.entities.agent_entities import ComposerSavePayload


class AgentBuildResourceCollector(Protocol):
    def __call__(self, *, tenant_id: str, binding_ids: tuple[str, ...]) -> None:
        """Schedule physical collection of already retired bindings in the given tenant."""
        ...


class AgentBuildConfig(Protocol):
    def prepare_save(self, context: RequestContext, payload: ComposerSavePayload) -> dict[str, object]:
        """Validate the Console's parsed save input and preserve omitted fields in the returned Soul."""
        ...

    def validate_apply(self, context: RequestContext, agent_soul: dict[str, object]) -> None:
        """Validate the prepared Soul and authorize its knowledge references before checkpointing."""
        ...


class AgentBuildSnapshots(Protocol):
    def create(self, *, tenant_id: str, agent_id: str, sandbox: AgentBuildSandbox) -> AgentBuildHomeSnapshot | None:
        """Checkpoint the prepared Sandbox. Return None if the backend reports checkpoints are unsupported."""
        ...

    def discard(self, snapshot: AgentBuildHomeSnapshot) -> None:
        """Attempt to remove a checkpoint that the repository definitively did not attach."""
        ...


class AgentBuildSessionService:
    """Use the admitted workspace and account for every operation and collect resources after commit."""

    def __init__(
        self,
        *,
        store: AgentBuildSessionStore,
        collect_resources: AgentBuildResourceCollector,
        config: AgentBuildConfig,
        snapshots: AgentBuildSnapshots,
    ) -> None:
        """Accept a store that commits writes before returning and a post-commit collector."""
        self._store = store
        self._collect_resources = collect_resources
        self._config = config
        self._snapshots = snapshots

    def refresh_conversation(self, context: RequestContext, agent_id: str) -> str:
        """Replace the caller's Build conversation, then schedule collection of the retired binding, if any."""
        result = self._store.refresh_build_conversation(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id
        )
        if result.retired_binding_id is not None:
            self._collect_resources(tenant_id=context.active_workspace_id, binding_ids=(result.retired_binding_id,))
        return result.conversation_id

    def get_draft(self, context: RequestContext, agent_id: str) -> AgentBuildDraft:
        """Return the admitted caller's existing Build draft without writing."""
        return self._store.get_build_draft(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id
        )

    def discard_draft(self, context: RequestContext, agent_id: str) -> None:
        """Discard only the admitted caller's Build draft, then schedule collection if a binding was retired."""
        retired = self._store.discard_build_draft(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id
        )
        if retired is not None:
            self._collect_resources(tenant_id=context.active_workspace_id, binding_ids=(retired,))

    def save_draft(self, context: RequestContext, agent_id: str, payload: ComposerSavePayload) -> AgentBuildDraft:
        """Validate parsed save input, then commit the admitted caller's draft."""
        soul = self._config.prepare_save(context, payload)
        return self._store.save_build_draft(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id, agent_soul=soul
        )

    def checkout_draft(self, context: RequestContext, agent_id: str, *, force: bool) -> AgentBuildDraft:
        """Check out the shared draft, collecting any replaced personal binding after commit."""
        result = self._store.checkout_build_draft(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id, force=force
        )
        if result.retired_binding_id is not None:
            self._collect_resources(tenant_id=context.active_workspace_id, binding_ids=(result.retired_binding_id,))
        return result.draft

    def apply_draft(self, context: RequestContext, agent_id: str) -> AgentDraftSummary:
        """Checkpoint a validated Build draft without a DB session, then commit only the prepared state."""
        tenant_id = context.active_workspace_id
        source = self._store.prepare_build_apply(tenant_id=tenant_id, agent_id=agent_id, account_id=context.account_id)
        self._config.validate_apply(context, source.agent_soul)
        if source.sandbox is None:
            raise AgentBuildBindingUnavailableError
        snapshot = self._snapshots.create(tenant_id=tenant_id, agent_id=agent_id, sandbox=source.sandbox)
        try:
            result = self._store.commit_build_apply(
                tenant_id=tenant_id,
                agent_id=agent_id,
                account_id=context.account_id,
                source=source,
                snapshot=snapshot,
            )
        except (AgentBuildApplyChangedError, AgentBuildBindingUnavailableError, AgentBuildBaseUnavailableError):
            if snapshot is not None:
                self._snapshots.discard(snapshot)
            raise
        # An unexpected database failure can leave the commit outcome unknown.
        # Do not delete a checkpoint that the shared draft might already reference.
        self._collect_resources(tenant_id=tenant_id, binding_ids=result.retired_binding_ids)
        return result.draft
