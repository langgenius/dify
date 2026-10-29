"""In-memory Builder credential boundary, with explicit scope assertions."""

from collections.abc import Mapping
from typing import Any

from services.workflow_test_credential_adapters import DraftTestCredentialPlanner
from services.workflow_test_credentials import (
    BuilderScope,
    BuilderTestMembership,
    ResolvedTestCredential,
    TestCredentialCheck,
    TestCredentialError,
    TestCredentialRequirement,
    TestCredentialUnavailableError,
    WorkflowTestCredentialService,
)

SCOPE = BuilderScope("tenant", "app", "builder")


def tool_node(node_id: str, credential_id: str | None = "credential", **fields: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "data": {
            "type": "tool",
            "title": node_id,
            "provider_id": "vendor/calendar/calendar",
            "provider_type": "builtin",
            "provider_name": "calendar",
            "tool_name": "read",
            "tool_label": "Read",
            "tool_configurations": {},
            "tool_parameters": {},
            "credential_source": "end_user",
            "test_credential_id": credential_id,
            "end_user_auth": {
                "allowed_credential_types": ["oauth2"],
                "oauth_client_type": "default",
                "purpose": "Read calendar",
            },
            **fields,
        },
    }


class BuilderCredentialHarness:
    def __init__(self, graph: Mapping[str, Any]) -> None:
        self.graph = graph
        self.membership = BuilderTestMembership("builder", "editor")
        self.available = True
        self.calls: list[str] = []
        self.check = TestCredentialCheck(status="valid", reason_code=None, retryable=False)
        self.failure: TestCredentialUnavailableError | None = None
        self.service = WorkflowTestCredentialService(
            access=self,
            planner=DraftTestCredentialPlanner(),
            credentials=self,
        )

    def get_test_membership(self, scope: BuilderScope) -> BuilderTestMembership | None:
        assert scope == SCOPE
        return self.membership if self.available else None

    def require_access(self, scope: BuilderScope) -> None:
        if self.get_test_membership(scope) is None:
            raise TestCredentialError("Builder cannot run this App.")

    def resolve(self, scope: BuilderScope, requirement: TestCredentialRequirement) -> ResolvedTestCredential:
        assert scope == SCOPE
        assert requirement.credential_id is not None
        self.calls.append(requirement.credential_id)
        if self.failure:
            raise self.failure
        return ResolvedTestCredential(requirement.credential_id, "oauth2", {"access_token": "secret"}, self.check)
