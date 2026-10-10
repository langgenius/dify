"""Access policy administration."""

from machinery.context import RequestContext
from services.rbac.contracts import (
    AccessPolicy,
    AccessPolicyBindingState,
    AccessPolicyCreate,
    AccessPolicyUpdate,
    ListOption,
    Paginated,
    RBACResourceType,
)
from services.rbac.ports import PoliciesGateway, PolicyBindingsGateway


class PolicyService:
    def __init__(self, *, policies: PoliciesGateway, bindings: PolicyBindingsGateway) -> None:
        self._policies = policies
        self._bindings = bindings

    def list(
        self,
        context: RequestContext,
        *,
        resource_type: RBACResourceType | str | None,
        options: ListOption,
        language: str | None,
    ) -> Paginated[AccessPolicy]:
        return self._policies.list(
            context.active_workspace_id,
            context.account_id,
            resource_type=resource_type,
            options=options,
            language=language,
        )

    def get(self, context: RequestContext, policy_id: str, *, language: str | None) -> AccessPolicy:
        return self._policies.get(context.active_workspace_id, context.account_id, policy_id, language=language)

    def create(self, context: RequestContext, payload: AccessPolicyCreate, *, language: str | None) -> AccessPolicy:
        return self._policies.create(context.active_workspace_id, context.account_id, payload, language=language)

    def update(
        self, context: RequestContext, policy_id: str, payload: AccessPolicyUpdate, *, language: str | None
    ) -> AccessPolicy:
        return self._policies.update(
            context.active_workspace_id, context.account_id, policy_id, payload, language=language
        )

    def delete(self, context: RequestContext, policy_id: str, *, language: str | None) -> None:
        return self._policies.delete(context.active_workspace_id, context.account_id, policy_id, language=language)

    def copy(self, context: RequestContext, policy_id: str, *, language: str | None) -> AccessPolicy:
        return self._policies.copy(context.active_workspace_id, context.account_id, policy_id, language=language)

    def lock(self, context: RequestContext, binding_id: str, *, language: str | None) -> AccessPolicyBindingState:
        return self._bindings.lock(context.active_workspace_id, context.account_id, binding_id, language=language)

    def unlock(self, context: RequestContext, binding_id: str, *, language: str | None) -> AccessPolicyBindingState:
        return self._bindings.unlock(context.active_workspace_id, context.account_id, binding_id, language=language)
