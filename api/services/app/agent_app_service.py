"""Application services for Agent App workflow references and presentation features."""

from collections.abc import Callable
from typing import Any, Protocol

from machinery.context import RequestContext
from services.app.agent_app_contracts import AgentApiAccess, AgentApiAccessChange, AgentReferencingWorkflow
from services.entities.app_entities import AppDeletion


class AgentAppReferences(Protocol):
    def resolve_existing_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str: ...

    def list_referencing_workflows(self, *, tenant_id: str, agent_id: str) -> list[AgentReferencingWorkflow]: ...


class AgentAppFeatures(Protocol):
    def resolve_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str: ...

    def update_features(self, *, tenant_id: str, app_id: str, account_id: str, config: dict[str, Any]) -> None: ...


class AgentFeatureValidator(Protocol):
    def validate_features(self, tenant_id: str, config: dict[str, Any]) -> dict[str, Any]: ...


class AgentApiAccessStore(Protocol):
    """Read and update API access within the Agent App's tenant scope."""

    def get_api_access(self, *, tenant_id: str, agent_id: str) -> AgentApiAccess:
        """Return access state, or raise AgentAppNotFoundError for an inaccessible Agent."""
        ...

    def set_api_access(self, *, tenant_id: str, agent_id: str, account_id: str, enabled: bool) -> AgentApiAccessChange:
        """Commit the setting and state together; reject enabling an unpublished Agent."""
        ...


class AgentApiAccessService:
    """Manage Agent API access and notify listeners only after a successful change."""

    def __init__(self, *, store: AgentApiAccessStore, notify_updated: Callable[[str, str], None]) -> None:
        self._store = store
        self._notify_updated = notify_updated

    def get(self, context: RequestContext, agent_id: str) -> AgentApiAccess:
        """Return the admitted workspace's Agent access state, or raise if absent."""
        return self._store.get_api_access(tenant_id=context.active_workspace_id, agent_id=agent_id)

    def set_enabled(self, context: RequestContext, agent_id: str, enabled: bool) -> AgentApiAccess:
        """Commit the setting and emit an update only when its value changes."""
        result = self._store.set_api_access(
            tenant_id=context.active_workspace_id, agent_id=agent_id, account_id=context.account_id, enabled=enabled
        )
        if result.changed:
            self._notify_updated(context.active_workspace_id, result.access.app_id)
        return result.access


class AgentAppDeletion(Protocol):
    """Delete a tenant-owned Agent App and publish its post-commit cleanup."""

    def delete_agent(self, context: RequestContext, agent_id: str) -> AppDeletion:
        """Commit the Agent App deletion or raise AgentAppNotFoundError."""
        ...

    def deleted(self, context: RequestContext, deleted: AppDeletion) -> None:
        """Publish cleanup for an already committed deletion."""
        ...


class AgentAppDeletionService:
    """Coordinate Agent App deletion and post-commit cleanup."""

    def __init__(self, *, lifecycle: AgentAppDeletion) -> None:
        self._lifecycle = lifecycle

    def delete(self, context: RequestContext, agent_id: str) -> None:
        """Delete the admitted workspace's Agent App, then publish its cleanup."""
        deleted = self._lifecycle.delete_agent(context, agent_id)
        self._lifecycle.deleted(context, deleted)


class AgentAppAccessService:
    def __init__(self, *, references: AgentAppReferences) -> None:
        self._references = references

    def resolve_existing_runtime_app_id(self, context: RequestContext, agent_id: str) -> str:
        return self._references.resolve_existing_runtime_app_id(
            tenant_id=context.active_workspace_id, agent_id=agent_id
        )

    def list_referencing_workflows(self, context: RequestContext, agent_id: str) -> list[AgentReferencingWorkflow]:
        return self._references.list_referencing_workflows(tenant_id=context.active_workspace_id, agent_id=agent_id)


class AgentAppFeatureConfigService:
    def __init__(self, *, features: AgentAppFeatures, validator: AgentFeatureValidator) -> None:
        self._features = features
        self._validator = validator

    def update_features(self, context: RequestContext, agent_id: str, config: dict[str, Any]) -> None:
        app_id = self._features.resolve_runtime_app_id(tenant_id=context.active_workspace_id, agent_id=agent_id)
        validated = self._validator.validate_features(context.active_workspace_id, config)
        self._features.update_features(
            tenant_id=context.active_workspace_id,
            app_id=app_id,
            account_id=context.account_id,
            config=validated,
        )
