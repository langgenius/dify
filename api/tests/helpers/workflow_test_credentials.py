"""In-memory Builder credential boundary, with explicit scope assertions."""

from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from services.workflow_test_credential_adapters import DraftTestCredentialPlanner
from services.workflow_test_credentials import (
    BuilderScope,
    ResolvedTestCredential,
    TestCredentialCheck,
    TestCredentialRequirement,
    TestCredentialUnavailableError,
    TestDraft,
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
        self.draft = TestDraft("workflow", "saved-hash", graph, "builder", "editor")
        self.available = True
        self.calls: list[str] = []
        self.check = TestCredentialCheck(status="valid", reason_code=None, retryable=False)
        self.failure: TestCredentialUnavailableError | None = None
        self.change_draft = False
        self.service = WorkflowTestCredentialService(
            drafts=self,
            planner=DraftTestCredentialPlanner(),
            credentials=self,
        )

    def get_test_draft(self, scope: BuilderScope) -> TestDraft | None:
        assert scope == SCOPE
        return self.draft if self.available else None

    def resolve(self, scope: BuilderScope, requirement: TestCredentialRequirement) -> ResolvedTestCredential:
        assert scope == SCOPE
        assert requirement.credential_id is not None
        self.calls.append(requirement.credential_id)
        if self.failure:
            raise self.failure
        if self.change_draft:
            self.draft = replace(self.draft, hash="changed-hash")
        return ResolvedTestCredential(requirement.credential_id, "oauth2", {"access_token": "secret"}, self.check)
