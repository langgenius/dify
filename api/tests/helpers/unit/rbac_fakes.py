"""Explicit RBAC transport and task fakes for exercising real application services."""

from dataclasses import dataclass, field

import pytest
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.rbac import RBACServices, build_rbac_services
from extensions.application_services.workspace import build_workspace_membership_services
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.enterprise.base import EnterpriseRequest
from tasks.initialize_created_app_rbac_access_task import initialize_created_app_rbac_access_task


@dataclass(frozen=True)
class RecordedRequest:
    method: str
    endpoint: str
    tenant_id: str
    account_id: str | None
    json: dict[str, object] | None
    params: dict[str, object] | None
    timeout: float


@dataclass
class RBACTransport:
    response: JsonValue = None
    failure: Exception | None = None
    requests: list[RecordedRequest] = field(default_factory=list)
    responses: dict[str, JsonValue] = field(default_factory=dict)

    def send(
        self,
        method: str,
        endpoint: str,
        *,
        tenant_id: str,
        account_id: str | None,
        json: dict[str, object] | None,
        params: dict[str, object] | None,
        timeout: float,
    ) -> JsonValue:
        self.requests.append(RecordedRequest(method, endpoint, tenant_id, account_id, json, params, timeout))
        if self.failure:
            raise self.failure
        return self.responses.get(endpoint, self.response)

    @property
    def only_request(self) -> RecordedRequest:
        assert len(self.requests) == 1
        return self.requests[0]


@dataclass(frozen=True)
class Initialization:
    tenant_id: str
    account_id: str
    resources: dict[str, str]


@dataclass
class AccessTasks:
    queued: list[Initialization] = field(default_factory=list)

    def delay(self, tenant_id: str, account_id: str, **resources: str) -> None:
        self.queued.append(Initialization(tenant_id, account_id, resources))


@dataclass
class RBACDomain:
    rbac: RBACServices
    transport: RBACTransport
    tasks: AccessTasks
    sessions: sessionmaker[Session]


def build_rbac_domain(sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> RBACDomain:
    transport = RBACTransport()
    tasks = AccessTasks()
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
    monkeypatch.setattr(initialize_created_app_rbac_access_task, "delay", tasks.delay)
    workspaces = WorkspaceRepository(sessions)
    members, _ = build_workspace_membership_services(
        workspaces=workspaces, accounts=SQLAlchemyAccountRepository(sessions)
    )
    return RBACDomain(
        rbac=build_rbac_services(
            workspaces=workspaces,
            workspace_members=members,
            apps=ConsoleAppRepository(session_factory=sessions),
            datasets=SQLAlchemyDatasetRepository(session_factory=sessions),
        ),
        transport=transport,
        tasks=tasks,
        sessions=sessions,
    )
