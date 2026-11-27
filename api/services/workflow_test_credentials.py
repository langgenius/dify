"""Builder-only test credentials, independent of personal Connections.

Each test uses the selections in its loaded execution graph. Admission and
runtime resolution check the selected workspace credentials. Workspace OAuth keeps its own Client and
refresh lifecycle, independently of the production EndUser Client choice.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, computed_field

from constants.end_user_connections import CredentialCheckStatus


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
    status: CredentialCheckStatus


class TestCredentialStatus(StrEnum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    INCOMPATIBLE = "incompatible"
    INVALID = "invalid"
    RECONNECT_REQUIRED = "reconnect_required"
    TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"


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
        return all(item.status is TestCredentialStatus.CONNECTED for item in self.credentials)


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


class TestDraftGraphQuery(Protocol):
    """Read the current saved draft through its tenant/App owner chain.

    The caller must authorize the Builder first. None means no draft is available.
    """

    def get_test_draft_graph(self, scope: BuilderScope) -> Mapping[str, Any] | None: ...


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


def _check_failure(status: CredentialCheckStatus) -> TestCredentialStatus | None:
    """Translate an unsuccessful provider check; valid and unsupported checks are admissible."""
    if status is CredentialCheckStatus.INVALID:
        return TestCredentialStatus.INVALID
    if status is CredentialCheckStatus.TEMPORARILY_UNAVAILABLE:
        return TestCredentialStatus.TEMPORARILY_UNAVAILABLE
    return None


class WorkflowTestCredentialService:
    def __init__(
        self,
        *,
        access: BuilderTestAccess,
        drafts: TestDraftGraphQuery,
        planner: TestCredentialPlanner,
        credentials: TestCredentialGateway,
    ) -> None:
        self._access = access
        self._drafts = drafts
        self._planner = planner
        self._credentials = credentials

    def preflight(self, scope: BuilderScope) -> TestCredentialReadiness:
        """Report all saved test selections without creating a Run or changing the graph."""
        self._access.require_access(scope)
        graph = self._drafts.get_test_draft_graph(scope)
        if graph is None:
            raise TestCredentialError("Workflow draft not found.")
        return self._readiness(scope, graph=graph, node_id=None)

    def require_ready(self, scope: BuilderScope, *, graph: Mapping[str, Any], node_id: str | None) -> None:
        self._access.require_access(scope)
        result = self._readiness(scope, graph=graph, node_id=node_id)
        if not result.ready:
            raise TestCredentialNotReadyError(result)

    def _readiness(
        self, scope: BuilderScope, *, graph: Mapping[str, Any], node_id: str | None
    ) -> TestCredentialReadiness:
        requirements = self._planner.requirements(graph, node_id)
        return TestCredentialReadiness(credentials=tuple(self._state(scope, item) for item in requirements))

    def resolve(self, scope: BuilderScope, *, graph: Mapping[str, Any], node_id: str) -> ResolvedTestCredential:
        self._access.require_access(scope)
        requirements = self._planner.requirements(graph, node_id)
        if len(requirements) != 1:
            raise TestCredentialError("The node has no independent EndUser authentication source.")
        requirement = requirements[0]
        if requirement.credential_id is None:
            raise TestCredentialUnavailableError(TestCredentialStatus.DISCONNECTED)
        resolved = self._credentials.resolve(scope, requirement)
        if (failure := _check_failure(resolved.check.status)) is not None:
            raise TestCredentialUnavailableError(failure)
        return resolved

    def _state(self, scope: BuilderScope, requirement: TestCredentialRequirement) -> TestCredentialState:
        credential_id = requirement.credential_id
        check = None
        status = TestCredentialStatus.DISCONNECTED
        if credential_id is not None:
            try:
                resolved = self._credentials.resolve(scope, requirement)
                check = resolved.check
                status = _check_failure(check.status) or TestCredentialStatus.CONNECTED
                if status is TestCredentialStatus.INVALID and check.reason_code in {
                    "credential_expired",
                    "credential_revoked",
                }:
                    status = TestCredentialStatus.RECONNECT_REQUIRED
            except TestCredentialUnavailableError as exc:
                status = exc.status
                if status is TestCredentialStatus.DISCONNECTED:
                    credential_id = None
        return TestCredentialState(
            node_id=requirement.node_id,
            node_ids=requirement.node_ids,
            credential_id=credential_id,
            status=status,
            check=check,
        )
