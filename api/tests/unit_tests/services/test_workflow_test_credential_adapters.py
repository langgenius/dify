from collections.abc import Sequence
from dataclasses import replace
from typing import cast

import pytest

from core.tools.__base.tool import Tool
from services.credentials.query import CredentialQuery
from services.workflow_test_credential_adapters import AuthorizedTestDraftQuery, DraftTestCredentialPlanner
from services.workflow_test_credentials import TestCredentialError as CredentialError
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node


def test_container_scope_includes_nested_tools_and_external_authentication_root() -> None:
    graph = {
        "nodes": [
            {"id": "loop", "data": {"type": "loop"}},
            {"id": "nested", "parentId": "loop", "data": {"type": "iteration"}},
            tool_node("root"),
            tool_node(
                "child",
                None,
                credential_source="reuse_node",
                reuse_node_id="root",
                end_user_auth=None,
                iteration_id="nested",
            ),
            tool_node("unrelated", None),
        ]
    }
    requirements = DraftTestCredentialPlanner().requirements(graph, "loop")
    assert len(requirements) == 1
    assert requirements[0].node_id == "root"
    assert requirements[0].node_ids == ("child",)
    assert requirements[0].credential_id == "credential"


@pytest.mark.parametrize("reuse", ["missing", "a"])
def test_invalid_reuse_is_not_a_workspace_fallback(reuse: str) -> None:
    graph = {"nodes": [tool_node("a", None, credential_source="reuse_node", reuse_node_id=reuse, end_user_auth=None)]}
    with pytest.raises(CredentialError):
        DraftTestCredentialPlanner().requirements(graph, "a")


def test_production_client_choice_does_not_change_test_credential() -> None:
    node = tool_node("a")
    node["data"]["end_user_auth"]["oauth_client_type"] = "custom"
    (requirement,) = DraftTestCredentialPlanner().requirements({"nodes": [node]}, "a")
    assert requirement.credential_id == "credential"


@pytest.mark.parametrize(
    ("rbac", "role", "owner", "allowed", "expected"),
    [
        (False, "editor", "other", False, True),
        (False, "normal", "builder", True, False),
        (True, "normal", "other", False, False),
        (True, "normal", "other", True, True),
        (True, "normal", "builder", False, True),
    ],
)
def test_worker_rechecks_current_builder_access(
    rbac: bool, role: str, owner: str, allowed: bool, expected: bool
) -> None:
    harness = BuilderCredentialHarness({"nodes": []})
    harness.draft = replace(harness.draft, member_role=role, owner_id=owner)
    query = AuthorizedTestDraftQuery(drafts=harness, rbac_enabled=rbac, can_run=lambda _scope: allowed)
    if expected:
        assert query.get_test_draft(SCOPE) == harness.draft
    else:
        with pytest.raises(CredentialError):
            query.get_test_draft(SCOPE)


@pytest.mark.parametrize("changed", ["removed", "permission", "type", "credentials"])
def test_workspace_gateway_rechecks_selection_after_external_validation(
    monkeypatch: pytest.MonkeyPatch, changed: str
) -> None:
    from dataclasses import replace
    from uuid import uuid4

    from core.plugin.entities.plugin_daemon import CredentialType
    from core.tools.__base.tool_runtime import ToolRuntime
    from core.tools.tool_manager import ToolManager
    from services.credentials.query import ToolCredentialRecord
    from services.workflow_test_credential_adapters import WorkspaceTestCredentialGateway
    from services.workflow_test_credentials import TestCredentialUnavailableError as Unavailable
    from tests.helpers.end_user_api_key import ScriptedAuth, plugin_provider

    credential_id = str(uuid4())
    provider = plugin_provider(SCOPE.tenant_id)
    record = ToolCredentialRecord(
        credential_id,
        "Key",
        "vendor/calendar/calendar",
        CredentialType.API_KEY,
        {"api_key": "encrypted"},
        False,
        "all_team_members",
        SCOPE.account_id,
        (),
        False,
    )

    class Queries:
        visible = [record]

        def list_tools(
            self, *, workspace_id: str, provider: str, actor_id: str | None, include_credential_ids: Sequence[str] = ()
        ) -> list[ToolCredentialRecord]:
            assert (workspace_id, provider, actor_id) == (SCOPE.tenant_id, record.provider, SCOPE.account_id)
            assert include_credential_ids == ()
            return self.visible

    queries = Queries()
    auth = ScriptedAuth()

    def change_selection() -> None:
        if changed in {"removed", "permission"}:
            queries.visible = []
        elif changed == "type":
            queries.visible = [replace(record, credential_type=CredentialType.OAUTH2)]
        else:
            queries.visible = [replace(record, credentials={"api_key": "replacement"})]

    auth.on_check = change_selection

    def load_runtime(**kwargs: object) -> Tool:
        assert kwargs["credential_id"] == credential_id
        return provider.get_tool("read").fork_tool_runtime(
            runtime=ToolRuntime(
                tenant_id=SCOPE.tenant_id,
                credential_id=credential_id,
                credentials={"api_key": "secret"},
            )
        )

    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_: provider)
    monkeypatch.setattr(ToolManager, "get_tool_runtime", load_runtime)
    node = tool_node("a", credential_id, end_user_auth={"allowed_credential_types": ["api-key"], "purpose": "Read"})
    (requirement,) = DraftTestCredentialPlanner().requirements({"nodes": [node]}, "a")
    gateway = WorkspaceTestCredentialGateway(queries=cast(CredentialQuery, queries), auth=auth)
    with pytest.raises(Unavailable):
        gateway.resolve(SCOPE, requirement)
    assert len(auth.calls) == 1


def test_workspace_gateway_refreshes_before_check_and_returns_only_runtime_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dataclasses import replace
    from uuid import uuid4

    from core.plugin.entities.oauth import OAuthSchema
    from core.plugin.entities.plugin_daemon import CredentialType
    from core.tools.__base.tool_runtime import ToolRuntime
    from core.tools.tool_manager import ToolManager
    from services.credentials.query import ToolCredentialRecord
    from services.workflow_test_credential_adapters import WorkspaceTestCredentialGateway
    from tests.helpers.end_user_api_key import ScriptedAuth, plugin_provider

    credential_id = str(uuid4())
    provider = plugin_provider(SCOPE.tenant_id)
    provider.entity.oauth_schema = OAuthSchema(
        client_schema=provider.entity.credentials_schema, credentials_schema=provider.entity.credentials_schema
    )
    record = ToolCredentialRecord(
        credential_id,
        "OAuth",
        "vendor/calendar/calendar",
        CredentialType.OAUTH2,
        {"access_token": "old-encrypted"},
        False,
        "only_me",
        SCOPE.account_id,
        (),
        False,
    )

    class Queries:
        current = record

        def list_tools(self, **_kwargs: object) -> list[ToolCredentialRecord]:
            return [self.current]

    queries = Queries()
    auth = ScriptedAuth()

    def load_runtime(**kwargs: object) -> Tool:
        assert kwargs["credential_id"] == credential_id
        queries.current = replace(record, credentials={"access_token": "refreshed-encrypted"})
        return provider.get_tool("read").fork_tool_runtime(
            runtime=ToolRuntime(
                tenant_id=SCOPE.tenant_id,
                credential_id=credential_id,
                credential_type=CredentialType.OAUTH2,
                credentials={"access_token": "refreshed-secret"},
            )
        )

    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_: provider)
    monkeypatch.setattr(ToolManager, "get_tool_runtime", load_runtime)
    (requirement,) = DraftTestCredentialPlanner().requirements({"nodes": [tool_node("a", credential_id)]}, "a")
    result = WorkspaceTestCredentialGateway(queries=cast(CredentialQuery, queries), auth=auth).resolve(
        SCOPE, requirement
    )
    assert result.credentials == {"access_token": "refreshed-secret"}
    assert auth.calls[0][3] == result.credentials
    assert result.credential_id == credential_id
    assert result.check.status == "valid"
