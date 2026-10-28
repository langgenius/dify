"""Builder-only test credentials, independent of personal Connections.

The saved draft owns test selections. Preflight is advisory: admission and
runtime resolution check them again. Workspace OAuth keeps its own Client and
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
class TestDraft:
    workflow_id: str
    hash: str
    graph: Mapping[str, Any]
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


class TestCredentialPreflight(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    credentials: tuple[TestCredentialState, ...]
    draft_hash: str

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


class TestCredentialDraftChangedError(TestCredentialError):
    def __init__(self) -> None:
        super().__init__("The draft has changed. Save the draft and check test credentials again.")


class TestCredentialNotReadyError(TestCredentialError):
    def __init__(self, result: TestCredentialPreflight) -> None:
        super().__init__("Required test credentials are not ready.")
        self.result = result


class TestCredentialUnavailableError(TestCredentialError):
    def __init__(self, status: TestCredentialStatus) -> None:
        super().__init__("The selected test credential is unavailable.")
        self.status = status


class TestDraftQuery(Protocol):
    """Read the current draft through its complete tenant/App owner chain."""

    def get_test_draft(self, scope: BuilderScope) -> TestDraft | None: ...


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
        self, *, drafts: TestDraftQuery, planner: TestCredentialPlanner, credentials: TestCredentialGateway
    ) -> None:
        self._drafts = drafts
        self._planner = planner
        self._credentials = credentials

    def check(self, scope: BuilderScope, *, draft_hash: str | None, node_id: str | None) -> TestCredentialPreflight:
        draft = self._drafts.get_test_draft(scope)
        if draft is None:
            raise TestCredentialError("Workflow draft not found.")
        requirements = self._planner.requirements(draft.graph, node_id)
        # Legacy graphs without personal test requirements need no new request field.
        if (draft_hash is not None and draft_hash != draft.hash) or (requirements and draft_hash is None):
            raise TestCredentialDraftChangedError()
        states = tuple(self._state(scope, item) for item in requirements)
        if requirements:
            current = self._drafts.get_test_draft(scope)
            if current is None or current.hash != draft.hash:
                raise TestCredentialDraftChangedError()
        return TestCredentialPreflight(draft_hash=draft.hash, credentials=states)

    def require_ready(
        self, scope: BuilderScope, *, draft_hash: str | None, node_id: str | None
    ) -> TestCredentialPreflight:
        result = self.check(scope, draft_hash=draft_hash, node_id=node_id)
        if not result.ready:
            raise TestCredentialNotReadyError(result)
        return result

    def resolve(self, scope: BuilderScope, *, graph: Mapping[str, Any], node_id: str) -> ResolvedTestCredential:
        if self._drafts.get_test_draft(scope) is None:
            raise TestCredentialError("Workflow draft not found.")
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
