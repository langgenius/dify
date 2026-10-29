"""Builder-only test credentials, independent of personal Connections.

Each test uses the selections in its loaded execution graph. Admission and
runtime resolution check the selected workspace credentials. Workspace OAuth keeps its own Client and
refresh lifecycle, independently of the production EndUser Client choice.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, computed_field


@dataclass(frozen=True)
class BuilderScope:
    tenant_id: str
    app_id: str
    account_id: str


@dataclass(frozen=True)
class BuilderTestMembership:
    # None means the App has no recorded creator.
    owner_id: str | None
    member_role: str


@dataclass(frozen=True)
class TestCredentialRequirement:
    node_id: str
    node_ids: tuple[str, ...]
    provider: str
    provider_type: str
    tool_name: str
    allowed_types: tuple[str, ...]
    # None means the Builder has not selected a test credential.
    credential_id: str | None


class TestCredentialCheck(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    reason_code: str | None
    retryable: bool
    status: Literal["invalid", "temporarily_unavailable", "unsupported", "valid"]


TestCredentialStatus = Literal[
    "connected", "disconnected", "incompatible", "invalid", "reconnect_required", "temporarily_unavailable"
]


class TestCredentialState(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    check: TestCredentialCheck | None
    credential_id: str | None
    node_id: str
    node_ids: tuple[str, ...]
    status: TestCredentialStatus


class TestCredentialReadiness(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    credentials: tuple[TestCredentialState, ...]

    @computed_field
    @property
    def ready(self) -> bool:
        return all(item.status == "connected" for item in self.credentials)


@dataclass(frozen=True)
class ResolvedTestCredential:
    credential_id: str
    credential_type: str
    credentials: Mapping[str, Any] = field(repr=False)
    check: TestCredentialCheck


class TestCredentialError(ValueError):
    pass


class TestCredentialNotReadyError(TestCredentialError):
    def __init__(self, result: TestCredentialReadiness) -> None:
        super().__init__("Required test credentials are not ready.")
        self.result = result


class TestCredentialUnavailableError(TestCredentialError):
    def __init__(self, status: TestCredentialStatus) -> None:
        super().__init__("The selected test credential is unavailable.")
        self.status = status


class BuilderTestMembershipQuery(Protocol):
    """Read active membership through the complete tenant/App/Account owner chain."""

    def get_test_membership(self, scope: BuilderScope) -> BuilderTestMembership | None: ...


class BuilderTestAccess(Protocol):
    def require_access(self, scope: BuilderScope) -> None: ...


class TestCredentialPlanner(Protocol):
    """Resolve only the requested node/subgraph and explicit authentication roots."""

    def requirements(self, graph: Mapping[str, Any], node_id: str | None) -> tuple[TestCredentialRequirement, ...]: ...


class TestCredentialGateway(Protocol):
    """Resolve an actor-visible workspace credential without invoking a tool.

    Recheck owner, Provider, type and permission after external checks. Reuse
    the workspace refresh lifecycle; never persist personal selections. Secrets
    are process-local and must not enter responses, execution payloads or logs.
    """

    def resolve(self, scope: BuilderScope, requirement: TestCredentialRequirement) -> ResolvedTestCredential: ...


class WorkflowTestCredentialService:
    def __init__(
        self, *, access: BuilderTestAccess, planner: TestCredentialPlanner, credentials: TestCredentialGateway
    ) -> None:
        self._access = access
        self._planner = planner
        self._credentials = credentials

    def require_ready(self, scope: BuilderScope, *, graph: Mapping[str, Any], node_id: str | None) -> None:
        self._access.require_access(scope)
        requirements = self._planner.requirements(graph, node_id)
        result = TestCredentialReadiness(credentials=tuple(self._state(scope, item) for item in requirements))
        if not result.ready:
            raise TestCredentialNotReadyError(result)

    def resolve(self, scope: BuilderScope, *, graph: Mapping[str, Any], node_id: str) -> ResolvedTestCredential:
        self._access.require_access(scope)
        requirements = self._planner.requirements(graph, node_id)
        if len(requirements) != 1:
            raise TestCredentialError("The node has no independent EndUser authentication source.")
        requirement = requirements[0]
        if requirement.credential_id is None:
            raise TestCredentialUnavailableError("disconnected")
        resolved = self._credentials.resolve(scope, requirement)
        if resolved.check.status not in {"valid", "unsupported"}:
            raise TestCredentialUnavailableError(resolved.check.status)
        return resolved

    def _state(self, scope: BuilderScope, requirement: TestCredentialRequirement) -> TestCredentialState:
        credential_id = requirement.credential_id
        check = None
        status: TestCredentialStatus = "disconnected"
        if credential_id is not None:
            try:
                resolved = self._credentials.resolve(scope, requirement)
                check = resolved.check
                status = "connected" if check.status in {"valid", "unsupported"} else check.status
                if check.status == "invalid" and check.reason_code in {"credential_expired", "credential_revoked"}:
                    status = "reconnect_required"
            except TestCredentialUnavailableError as exc:
                status = exc.status
                if status == "disconnected":
                    credential_id = None
        return TestCredentialState(
            node_id=requirement.node_id,
            node_ids=requirement.node_ids,
            credential_id=credential_id,
            status=status,
            check=check,
        )
