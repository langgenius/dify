"""Application services for Agent App workflow references and presentation features."""

from typing import Any, Protocol

from machinery.context import RequestContext
from services.app.agent_app_contracts import AgentReferencingWorkflow


class AgentAppReferences(Protocol):
    def list_referencing_workflows(self, *, tenant_id: str, agent_id: str) -> list[AgentReferencingWorkflow]: ...


class AgentAppFeatures(Protocol):
    def resolve_runtime_app_id(self, *, tenant_id: str, agent_id: str) -> str: ...

    def update_features(self, *, tenant_id: str, app_id: str, account_id: str, config: dict[str, Any]) -> None: ...


class AgentFeatureValidator(Protocol):
    def validate_features(self, tenant_id: str, config: dict[str, Any]) -> dict[str, Any]: ...


class AgentAppAccessService:
    def __init__(self, *, references: AgentAppReferences) -> None:
        self._references = references

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
