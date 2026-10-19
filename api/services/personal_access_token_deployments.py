"""PAT configuration adapter for the existing App Runner Console catalog.

The upstream Console enforces current-workspace deployment-management access.
Returned deployments are eligible regardless of their runtime state or API switch.
The Console list defines visibility: an omitted deployment is unavailable, including
records hidden by the upstream undeploy filter.
"""

from collections.abc import Callable, Mapping
from typing import Protocol
from uuid import UUID

import httpx
from pydantic import BaseModel, Field, ValidationError

from services.enterprise.base import EnterpriseRequest
from services.errors.enterprise import EnterpriseAPIForbiddenError, EnterpriseAPINotFoundError, EnterpriseServiceError
from services.personal_access_token_service import (
    PersonalAccessTokenCatalogUnavailableError,
    PersonalAccessTokenDeploymentSnapshot,
    PersonalAccessTokenResourceView,
)


class DeploymentContext(Protocol):
    def deployment_context(self, account_id: str) -> tuple[str | None, tuple[PersonalAccessTokenResourceView, ...]]: ...


class _Environment(BaseModel):
    display_name: str


class _Deployment(BaseModel):
    deployment_id: UUID
    environment: _Environment


class _Deployments(BaseModel):
    environment_deployments: list[_Deployment] = Field()


class ConsolePersonalAccessTokenDeploymentCatalog:
    def __init__(
        self, *, context: DeploymentContext, headers: Callable[[], Mapping[str, str]], enabled: Callable[[], bool]
    ) -> None:
        self._context = context
        self._headers = headers
        self._enabled = enabled

    def snapshot(self, account_id: str) -> PersonalAccessTokenDeploymentSnapshot:
        current, apps = self._context.deployment_context(account_id)
        if not self._enabled() or current is None:
            return PersonalAccessTokenDeploymentSnapshot(current, ())
        headers = self._headers()
        if not headers.get("Authorization") or not headers.get("X-CSRF-Token"):
            raise PersonalAccessTokenCatalogUnavailableError()
        resources = []
        for app in apps:
            try:
                response = EnterpriseRequest.send_request(
                    "GET",
                    f"/console/api/enterprise/app-deploy/apps/{app.resource_id}/workflows/environment-deployments",
                    extra_headers=headers,
                )
                deployments = _Deployments.model_validate(response)
            except (EnterpriseAPIForbiddenError, EnterpriseAPINotFoundError):
                continue
            except (EnterpriseServiceError, httpx.HTTPError, ValidationError, ValueError) as error:
                # A service outage or an old server contract is not a revoked grant.
                raise PersonalAccessTokenCatalogUnavailableError() from error
            for deployment in deployments.environment_deployments:
                name = f"{app.display_name} / {deployment.environment.display_name}"
                resources.append(
                    PersonalAccessTokenResourceView(
                        resource_type="app_runner",
                        resource_id=str(deployment.deployment_id),
                        workspace_id=current,
                        display_name=name,
                        workspace_name=app.workspace_name,
                        available=True,
                        reason=None,
                        parent_app_id=app.resource_id,
                        display_name_snapshot=name,
                        workspace_name_snapshot=app.workspace_name,
                    )
                )
        return PersonalAccessTokenDeploymentSnapshot(
            current, tuple(sorted(resources, key=lambda r: (r.display_name, r.resource_id)))
        )
