"""Admit one atomic External workflow binding replacement without changing jobs."""

from dataclasses import dataclass
from typing import Protocol

from machinery.context import RequestContext

from .contracts import ExternalAgentForbiddenError, ExternalAgentInvalidInputError, ExternalAssetAccess


@dataclass(frozen=True, slots=True)
class RebindResult:
    workflow_id: str
    hash: str
    node_ids: tuple[str, ...]
    binding_epochs: dict[str, str | None]


class WorkflowBindingAccess(Protocol):
    def require_edit(self, context: RequestContext, app_id: str) -> None:
        """Require effective current App edit access before a repository transaction."""
        ...


class WorkflowBindingStore(Protocol):
    def rebind(
        self,
        *,
        context: RequestContext,
        app_id: str,
        node_id: str,
        target_agent_id: str,
        expected_hash: str,
        include_matching: bool,
        visible_ids: frozenset[str] | None,
    ) -> RebindResult: ...


class ExternalWorkflowBindingService:
    def __init__(
        self, *, store: WorkflowBindingStore, access: ExternalAssetAccess, workflows: WorkflowBindingAccess
    ) -> None:
        self._store, self._access, self._workflows = store, access, workflows

    def rebind(
        self,
        context: RequestContext,
        *,
        app_id: str,
        node_id: str,
        target_agent_id: str,
        expected_hash: str,
        include_matching: bool = True,
    ) -> RebindResult:
        """Preflight access, then commit all selected bindings under one draft lock.

        Editors select existing assets; this operation never creates an Agent or
        connection. Repository rechecks membership, ownership and draft CAS.
        """
        if self._access.role(context) not in {"owner", "admin", "editor"}:
            raise ExternalAgentForbiddenError("Workspace editor access is required.")
        self._workflows.require_edit(context, app_id)
        visible = self._access.visible_agent_ids(context)
        if visible is not None and target_agent_id not in visible:
            raise ExternalAgentForbiddenError("The target External Agent is not accessible.")
        try:
            return self._store.rebind(
                context=context,
                app_id=app_id,
                node_id=node_id,
                target_agent_id=target_agent_id,
                expected_hash=expected_hash,
                include_matching=include_matching,
                visible_ids=visible,
            )
        except ValueError:
            raise ExternalAgentInvalidInputError("The External workflow configuration is invalid.") from None
