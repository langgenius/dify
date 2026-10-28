"""Adapt saved tool configuration and workspace credential runtime for Builder tests."""

from collections.abc import Callable, Mapping
from typing import Any
from uuid import UUID

from clients.plugin.auth import PluginCredentialAuthClient
from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolProviderType
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from models.provider_ids import ToolProviderID
from services.credentials.query import CredentialQuery, ToolCredentialRecord
from services.workflow.tool_credentials import resolve_tool_credential_root
from services.workflow_test_credentials import (
    BuilderScope,
    ResolvedTestCredential,
    TestCredentialCheck,
    TestCredentialError,
    TestCredentialRequirement,
    TestCredentialUnavailableError,
    TestDraft,
    TestDraftQuery,
)


class AuthorizedTestDraftQuery:
    def __init__(self, *, drafts: TestDraftQuery, rbac_enabled: bool, can_run: Callable[[BuilderScope], bool]) -> None:
        self._drafts = drafts
        self._rbac_enabled = rbac_enabled
        self._can_run = can_run

    def get_test_draft(self, scope: BuilderScope) -> TestDraft | None:
        draft = self._drafts.get_test_draft(scope)
        if draft is None:
            return None
        if self._rbac_enabled:
            if draft.owner_id != scope.account_id and not self._can_run(scope):
                raise TestCredentialError("Builder cannot run this App.")
        elif draft.member_role not in {"owner", "admin", "editor"}:
            raise TestCredentialError("Builder cannot run this App.")
        return draft


class DraftTestCredentialPlanner:
    def requirements(self, graph: Mapping[str, Any], node_id: str | None) -> tuple[TestCredentialRequirement, ...]:
        nodes = {node["id"]: node for node in graph.get("nodes", []) if node.get("type") != "custom-note"}
        selected = set(nodes) if node_id is None else {node_id}
        if node_id is not None:
            if node_id not in nodes:
                raise TestCredentialError("Test node not found.")
            if nodes[node_id]["data"].get("type") in {"iteration", "loop"}:
                # Include nested containers, but not unrelated nodes in the draft.
                while True:
                    descendants = {
                        key
                        for key, value in nodes.items()
                        if value.get("parentId") in selected
                        or value["data"].get("iteration_id") in selected
                        or value["data"].get("loop_id") in selected
                    }
                    if descendants <= selected:
                        break
                    selected |= descendants
        roots: dict[str, TestCredentialRequirement] = {}
        for key in sorted(selected):
            data = nodes[key]["data"]
            if data.get("type") != "tool" or data.get("credential_source", "workspace") == "workspace":
                continue
            try:
                root_id, root = resolve_tool_credential_root(graph, key)
            except ValueError as exc:
                raise TestCredentialError(f"Invalid test authentication configuration for node {key}.") from exc
            if root.credential_source == "workspace":
                continue
            auth = root.end_user_auth
            if auth is None or not auth.allowed_credential_types:
                raise TestCredentialError(f"Authentication methods are missing for node {root_id}.")
            previous = roots.get(root_id)
            roots[root_id] = TestCredentialRequirement(
                node_id=root_id,
                node_ids=tuple(sorted(set((previous.node_ids if previous else ()) + (key,)))),
                provider=root.provider_id,
                provider_type=root.provider_type.value,
                tool_name=root.tool_name,
                allowed_types=tuple(auth.allowed_credential_types),
                credential_id=root.test_credential_id,
            )
        return tuple(roots[key] for key in sorted(roots))


class WorkspaceTestCredentialGateway:
    def __init__(self, *, queries: CredentialQuery, auth: PluginCredentialAuthClient) -> None:
        self._queries = queries
        self._auth = auth

    def _record(self, scope: BuilderScope, requirement: TestCredentialRequirement) -> ToolCredentialRecord:
        # Never use include_credential_ids: caller-supplied references are not grants.
        provider = str(ToolProviderID(requirement.provider))
        records = self._queries.list_tools(workspace_id=scope.tenant_id, provider=provider, actor_id=scope.account_id)
        record = next((item for item in records if item.id == requirement.credential_id), None)
        if record is None:
            raise TestCredentialUnavailableError("disconnected")
        if record.credential_type.value not in requirement.allowed_types:
            raise TestCredentialUnavailableError("incompatible")
        return record

    def resolve(self, scope: BuilderScope, requirement: TestCredentialRequirement) -> ResolvedTestCredential:
        try:
            UUID(requirement.credential_id or "")
        except ValueError:
            raise TestCredentialUnavailableError("disconnected") from None
        record = self._record(scope, requirement)
        try:
            provider = ToolManager.get_builtin_provider(requirement.provider, scope.tenant_id)
            if not isinstance(provider, PluginToolProviderController):
                raise TestCredentialUnavailableError("incompatible")
            if record.credential_type not in provider.get_supported_credential_types():
                raise TestCredentialUnavailableError("incompatible")
            tool = ToolManager.get_tool_runtime(
                provider_type=ToolProviderType(requirement.provider_type),
                provider_id=requirement.provider,
                tool_name=requirement.tool_name,
                tenant_id=scope.tenant_id,
                user_id=scope.account_id,
                invoke_from=InvokeFrom.DEBUGGER,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                credential_id=record.id,
            )
            if tool.runtime.credential_id != record.id or tool.runtime.credential_type != record.credential_type:
                raise TestCredentialUnavailableError("incompatible")
            checked_record = self._record(scope, requirement)
            result = self._auth.check_provider_credentials(
                tenant_id=scope.tenant_id,
                user_id=scope.account_id,
                provider=requirement.provider,
                credential_type=CredentialType(record.credential_type),
                credentials=tool.runtime.credentials,
                plugin_unique_identifier=provider.plugin_unique_identifier,
            )
        except TestCredentialUnavailableError:
            raise
        except Exception:
            # Legacy refresh failures do not reliably distinguish invalid grants
            # from outages. Preserve that uncertainty without invalidating rows.
            raise TestCredentialUnavailableError("temporarily_unavailable") from None
        current = self._record(scope, requirement)
        if current.credential_type != record.credential_type:
            raise TestCredentialUnavailableError("incompatible")
        if current.credentials != checked_record.credentials:
            raise TestCredentialUnavailableError("temporarily_unavailable")
        return ResolvedTestCredential(
            credential_id=record.id,
            credential_type=record.credential_type.value,
            credentials=dict(tool.runtime.credentials),
            check=TestCredentialCheck(status=result.status, reason_code=result.reason_code, retryable=result.retryable),
        )
