"""Resolve knowledge API identity and scope without transport or persistence details."""

from dataclasses import dataclass
from typing import Protocol

from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.resource_scope import DatasetRef


@dataclass(frozen=True, slots=True)
class DatasetAdmissionPolicy:
    rate_limit: bool = False
    billing_resources: tuple[str, ...] = ()
    require_paid_segments: bool = False
    require_edit_permission: bool = False


class DatasetAdmissionIdentityError(Exception):
    """A dataset token no longer identifies an active workspace owner."""


class DatasetAdmissionScopeError(DatasetAccessDeniedError):
    def __init__(self, message: str) -> None:
        Exception.__init__(self, message)


class DatasetAdmissionDatasets(Protocol):
    def get_api_enabled(self, dataset_ref: DatasetRef) -> bool | None: ...


class DatasetAdmissionKeys(Protocol):
    def get_active_scope(self, workspace_id: str, api_key_id: str) -> frozenset[str] | None:
        """None means revoked or foreign; an empty scope means an active unrestricted key."""
        ...


class DatasetAdmissionWorkspaces(Protocol):
    def active_owner_id(self, workspace_id: str) -> str | None: ...


class DatasetAdmissionLimits(Protocol):
    def check(
        self,
        workspace_id: str,
        *,
        rate_limit: bool,
        billing_resources: tuple[str, ...],
        require_paid_segments: bool,
    ) -> None: ...


class DatasetAdmissionService:
    def __init__(
        self,
        *,
        datasets: DatasetAdmissionDatasets,
        keys: DatasetAdmissionKeys,
        workspaces: DatasetAdmissionWorkspaces,
        limits: DatasetAdmissionLimits,
    ) -> None:
        self._datasets = datasets
        self._keys = keys
        self._workspaces = workspaces
        self._limits = limits

    def admit(
        self,
        *,
        workspace_id: str | None,
        api_key_id: str | None,
        resource_dataset_ids: frozenset[str] | None,
        dataset_id: str | None,
        request_id: str,
        trace_id: str | None,
        remote_ip: str | None,
        policy: DatasetAdmissionPolicy,
    ) -> RequestContext:
        if not workspace_id:
            raise DatasetAdmissionIdentityError("Tenant id is required for this token.")
        if resource_dataset_ids is not None:
            if dataset_id is not None and dataset_id not in resource_dataset_ids:
                raise DatasetAdmissionScopeError(
                    "The resource access token is not authorized to access this knowledge base."
                )
        elif api_key_id is not None:
            # Bindings are deliberately read on every request so key edits take effect immediately.
            bound_ids = self._keys.get_active_scope(workspace_id, api_key_id)
            if bound_ids is None:
                raise DatasetAdmissionIdentityError("The API key no longer exists.")
            if bound_ids and (dataset_id is None or dataset_id not in bound_ids):
                raise DatasetAdmissionScopeError("The API key is not authorized to access this knowledge base.")
        if dataset_id is not None:
            enabled = self._datasets.get_api_enabled(DatasetRef(workspace_id, dataset_id))
            if enabled is None:
                raise DatasetNotFoundError()
            if not enabled:
                raise DatasetAdmissionScopeError("Dataset api access is not enabled.")
        owner_id = self._workspaces.active_owner_id(workspace_id)
        if owner_id is None:
            raise DatasetAdmissionIdentityError("Tenant does not exist.")
        self._limits.check(
            workspace_id,
            rate_limit=policy.rate_limit,
            billing_resources=policy.billing_resources,
            require_paid_segments=policy.require_paid_segments,
        )
        return RequestContext(
            account_id=owner_id,
            active_workspace_id=workspace_id,
            request_id=request_id,
            trace_id=trace_id,
            remote_ip=remote_ip,
            resource_dataset_ids=resource_dataset_ids,
        )
