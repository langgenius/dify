"""Application services for Agent App workflow references and presentation features."""

from collections.abc import Callable
from dataclasses import replace
from typing import Any, Protocol

from machinery.context import RequestContext
from services.app.agent_app_contracts import (
    AgentApiAccess,
    AgentApiAccessChange,
    AgentAppDetail,
    AgentAppListPage,
    AgentAppNotFoundError,
    AgentReferencingWorkflow,
)
from services.entities.app_entities import (
    AppCreationSettings,
    AppDeletion,
    AppListParams,
    AppRecord,
    CreateAppParams,
    UpdateAppParams,
)
from services.rbac.contracts import ResourcePermissionSnapshot


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


class AgentAppDetailRuntime(Protocol):
    """Materialize Agent runtime details and commit changes in bounded transactions."""

    def get_agent_detail(self, context: RequestContext, agent_id: str) -> AgentAppDetail: ...

    def get_agent_build_conversation(
        self, context: RequestContext, agent_id: str, *, app_id: str
    ) -> tuple[str, int]: ...

    def update_agent(self, context: RequestContext, agent_id: str, params: UpdateAppParams) -> str: ...

    def agent_updated(self, context: RequestContext, app_id: str) -> None: ...


class AgentAppDetailPresentation(Protocol):
    def present(self, context: RequestContext, detail: AgentAppDetail) -> AgentAppDetail:
        """Resolve external metadata without holding a database transaction."""
        ...


class AgentAppDetailService:
    """Coordinate Agent App updates, external metadata and editor Build conversations."""

    def __init__(self, *, runtime: AgentAppDetailRuntime, presentation: AgentAppDetailPresentation) -> None:
        self._runtime = runtime
        self._presentation = presentation

    def get(self, context: RequestContext, agent_id: str) -> AgentAppDetail:
        """Return a detached detail for an admitted Agent and ensure its Build conversation exists."""
        detail = self._runtime.get_agent_detail(context, agent_id)
        detail = self._presentation.present(context, detail)
        conversation_id, count = self._runtime.get_agent_build_conversation(context, agent_id, app_id=detail.app.id)
        return replace(detail, debug_conversation_id=conversation_id, debug_conversation_message_count=count)

    def update(self, context: RequestContext, agent_id: str, params: UpdateAppParams) -> AgentAppDetail:
        """Commit an Agent App update, send its update event, and return the current detail."""
        app_id = self._runtime.update_agent(context, agent_id, params)
        self._runtime.agent_updated(context, app_id)
        return self.get(context, agent_id)


class AgentAppCollectionStore(Protocol):
    """Load one Agent App page and materialize its editor conversations."""

    def list_apps(
        self, context: RequestContext, params: AppListParams, *, accessible_agent_ids: set[str] | None
    ) -> AgentAppListPage:
        """Return a tenant-scoped page after committing its per-account Build conversations.

        The adapter enforces one editor mapping per Agent, account and draft surface
        with a unique key. A failure rolls back the page's conversation changes.
        """
        ...


class AgentAppCollectionAccess(Protocol):
    """Resolve list visibility before starting the database work."""

    def permissions(self, context: RequestContext) -> tuple[set[str] | None, ResourcePermissionSnapshot]:
        """Return the visible Agent ids and the admitted caller's Agent permissions."""
        ...


class AgentAppCreator(Protocol):
    """Create an Agent App and its backing roster Agent in one transaction."""

    def prepare_creation(self, context: RequestContext, params: CreateAppParams) -> AppCreationSettings:
        """Resolve creation defaults before opening the App creation transaction."""
        ...

    def create(self, context: RequestContext, params: CreateAppParams, settings: AppCreationSettings) -> AppRecord:
        """Commit the new App and its Agent, or roll back both on failure."""
        ...

    def created(self, context: RequestContext, app: AppRecord) -> None:
        """Notify existing listeners after the App creation commits."""
        ...


class AgentAppCollectionService:
    """Coordinate Agent App creation and per-account collection presentation."""

    def __init__(
        self,
        *,
        store: AgentAppCollectionStore,
        access: AgentAppCollectionAccess,
        creator: AgentAppCreator,
        detail: AgentAppDetailService,
    ) -> None:
        self._store = store
        self._access = access
        self._creator = creator
        self._detail = detail

    def list_apps(self, context: RequestContext, params: AppListParams) -> AgentAppListPage:
        """Return only visible Agents with permission keys, with no open session on return."""
        agent_ids, permissions = self._access.permissions(context)
        page = self._store.list_apps(context, params, accessible_agent_ids=agent_ids)
        keys = permissions.permission_keys_by_resource_ids([item.agent_id for item in page.data if item.agent_id])
        return replace(
            page,
            data=[
                replace(item, permission_keys=keys.get(item.agent_id, [])) if item.agent_id else item
                for item in page.data
            ],
        )

    def create(self, context: RequestContext, params: CreateAppParams) -> AgentAppDetail:
        """Create an Agent App, then return the admitted creator's complete Agent detail."""
        settings = self._creator.prepare_creation(context, params)
        app = self._creator.create(context, params, settings)
        self._creator.created(context, app)
        if app.bound_agent_id is None:
            raise AgentAppNotFoundError
        return self._detail.get(context, app.bound_agent_id)


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
