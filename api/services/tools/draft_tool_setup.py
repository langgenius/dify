"""Metadata-only admission for installed Tools in normal application drafts.

An installed declaration permits draft binding, never credential use. Every
run/publish rechecks the declaration and actual native credential selection.
Builder requires actor visibility; ordinary execution may retain an exact
explicit credential binding already saved on its workflow node. This policy never loads/decrypts credential
values, refreshes OAuth, calls providers or reads canvas notes as authority.
Published Service API/WebApp delegation and Builder consent/restricted execution
retain their existing owners.

Publication callers prepare detached declarations before their write/row-lock
phase, then validate credentials on the exact graph selected inside that phase.
The snapshot is internal, tenant/action-bound and never persisted in a graph.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, Never
from uuid import UUID

from core.tools.errors import ToolProviderCredentialValidationError
from core.workflow.generator.tool_catalogue import build_tool_catalogue
from models.provider_ids import ToolProviderID
from services.credentials.query import CredentialQuery, ToolCredentialMetadata, WorkflowToolCredentialMetadata
from services.workflow_ref_service import WorkflowRef

if TYPE_CHECKING:
    from sqlalchemy import Select
    from sqlalchemy.orm import Session, sessionmaker

    from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
    from models.account import Account
    from models.model import App, EndUser
    from models.tools import BuiltinToolProvider
    from models.workflow import Workflow, WorkflowRun

INVENTORY_TOOL_PROVIDER_TYPES = frozenset({"builtin", "plugin"})


ToolSetupReason = Literal["credential_unavailable", "authorization_lookup_failed"]


@dataclass(frozen=True, slots=True)
class ToolSetupFailure:
    """Bounded public setup facts; never credential IDs or provider error bodies."""

    reason: ToolSetupReason
    node_id: str | None
    provider: str
    action: str


class DraftToolSetupError(ToolProviderCredentialValidationError):
    """Compatible native refusal carrying optional validated public attribution."""

    def __init__(self, message: str, *, reason: ToolSetupReason, node: Mapping[str, Any]):
        super().__init__(message)
        provider, action = tool_key(node["data"])
        node_id = node.get("id")
        public = r"(?!.*://)[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,127}"
        self.setup_failure = (
            ToolSetupFailure(
                reason=reason,
                node_id=node_id if isinstance(node_id, str) and re.fullmatch(public, node_id) else None,
                provider=provider,
                action=action,
            )
            if re.fullmatch(public, provider) and re.fullmatch(public, action)
            else None
        )


@dataclass(frozen=True, slots=True)
class ToolDeclaration:
    provider: str
    action: str
    label: str
    needs_credentials: bool
    is_plugin: bool


@dataclass(frozen=True, slots=True)
class DraftToolDeclarations:
    """One operation's verified installed actions, detached before writes/locks."""

    tenant_id: str
    tools: tuple[ToolDeclaration, ...]
    source_unavailable: bool = False


def inventory_tool_nodes(graph: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Existing built-in/plugin Tool nodes; other provider types keep their owners."""
    return [
        node
        for node in graph.get("nodes") or []
        if isinstance(node, dict)
        and isinstance(data := node.get("data"), dict)
        and data.get("type") == "tool"
        and str(data.get("provider_type") or "builtin") in INVENTORY_TOOL_PROVIDER_TYPES
    ]


def tool_key(data: Mapping[str, Any]) -> tuple[str, str]:
    return str(data.get("provider_id") or data.get("provider_name") or ""), str(data.get("tool_name") or "")


def _find_tool_declaration(tools: tuple[ToolDeclaration, ...], provider: str, action: str) -> ToolDeclaration | None:
    """Resolve native plugin aliases without changing exact hardcoded identities."""
    exact = next((tool for tool in tools if (tool.provider, tool.action) == (provider, action)), None)
    if exact is not None or not provider:
        return exact
    try:
        canonical = str(ToolProviderID(provider))
    except ValueError:
        return None
    return next(
        (tool for tool in tools if tool.is_plugin and (tool.provider, tool.action) == (canonical, action)), None
    )


def draft_tool_execution_graph(graph: Mapping[str, Any], node_id: str) -> Mapping[str, Any]:
    """Select one node and its nested container children using native ownership.

    The stored graph is unchanged. Unrelated siblings cannot prevent isolated
    debugging; the requested node and every nested child retain admission.
    """
    from graphon.graph.scoping import resolve_container_id

    nodes = graph.get("nodes", [])
    by_id = {node["id"]: node for node in nodes}
    if node_id not in by_id:
        raise ValueError(f"Node {node_id} not found in workflow")
    selected = {node_id}
    if by_id[node_id]["data"].get("type") in {"iteration", "loop"}:
        owners = {key: resolve_container_id(node, nodes_by_id=by_id) for key, node in by_id.items()}
        children = {key for key, owner in owners.items() if owner in selected} - selected
        while children:
            selected.update(children)
            children = {key for key, owner in owners.items() if owner in selected} - selected
    return {**graph, "nodes": [node for node in nodes if node["id"] in selected]}


def prepare_tool_declarations(*, tenant_id: str, graph: Mapping[str, Any]) -> DraftToolDeclarations:
    """Fresh verified public metadata, with no SQL write session held by the caller."""
    requested = {tool_key(node["data"]) for node in inventory_tool_nodes(graph)}
    if not requested:
        return DraftToolDeclarations(tenant_id=tenant_id, tools=())
    failures: list[str] = []
    try:
        entries = build_tool_catalogue(tenant_id, on_source_error=failures.append)
    except Exception:
        entries = []
        failures.append("catalogue")
    installed = tuple(
        ToolDeclaration(
            provider=entry["provider_name"],
            action=entry["tool_name"],
            label=entry["tool_label"] or entry["tool_name"],
            needs_credentials=entry["needs_credentials"],
            is_plugin=bool(entry.get("plugin_id")),
        )
        for entry in entries
    )
    return DraftToolDeclarations(
        tenant_id=tenant_id,
        source_unavailable=bool(failures),
        tools=tuple(
            tool
            for provider, action in sorted(requested)
            if (tool := _find_tool_declaration(installed, provider, action)) is not None
        ),
    )


def _refuse_missing_declaration(declarations: DraftToolDeclarations, provider: str, action: str) -> Never:
    if declarations.source_unavailable:
        from services.dify_builder.native_launch_observation import observe_resource

        # Positive source failure, not merely an empty catalogue or absent
        # credential. Associate only the requested declaration lookup.
        with observe_resource("tool", provider, action):
            raise ToolProviderCredentialValidationError(
                "Installed Tool metadata service unavailable. Check workspace access and plugin services."
            )
    raise ToolProviderCredentialValidationError("Tool action is not verified as installed in this workspace.")


def _selected_credential_metadata(
    *,
    query: CredentialQuery,
    tenant_id: str,
    actor_id: str | None,
    declaration: ToolDeclaration,
    credential_id: object,
    workflow_ref: WorkflowRef | None = None,
    node_id: str | None = None,
) -> ToolCredentialMetadata | None:
    """Exact native selection and canonical provider chain; query failures propagate.

    ``None``/empty ID means the actual native default/oldest. A supplied invalid
    ID cannot silently fall back. No actor permits only team-shared metadata.
    """
    if not declaration.needs_credentials:
        return None
    selected_id = None
    if credential_id is not None and credential_id != "":
        if type(credential_id) is not str:
            return None
        try:
            if str(UUID(credential_id)) != credential_id:
                return None
        except ValueError:
            return None
        selected_id = credential_id
    metadata = None
    if (
        selected_id is not None
        and declaration.is_plugin
        and workflow_ref is not None
        and workflow_ref.tenant_id == tenant_id
        and node_id is not None
    ):
        metadata = query.resolve_workflow_tool_credential_metadata(
            workflow_ref=workflow_ref,
            node_id=node_id,
            provider=declaration.provider,
            action=declaration.action,
            credential_id=selected_id,
        )
    if metadata is None:
        legacy_provider = ToolProviderID(declaration.provider).provider_name if declaration.is_plugin else None
        metadata = query.resolve_tool_credential_metadata(
            workspace_id=tenant_id,
            provider=declaration.provider,
            legacy_provider=legacy_provider,
            actor_id=actor_id,
            credential_id=selected_id,
        )
    if not isinstance(metadata, ToolCredentialMetadata):
        return None
    if selected_id is not None and metadata.id != selected_id:
        return None
    if metadata.provider == declaration.provider:
        return metadata
    # A legacy short name is canonical only for its real native provider, not
    # another organization's plugin with the same provider-name suffix.
    if declaration.is_plugin:
        try:
            return metadata if str(ToolProviderID(metadata.provider)) == declaration.provider else None
        except ValueError:
            return None
    return None


def selected_credential_is_available(
    *,
    query: CredentialQuery,
    tenant_id: str,
    actor_id: str | None,
    declaration: ToolDeclaration,
    credential_id: object,
    workflow_ref: WorkflowRef | None = None,
    node_id: str | None = None,
) -> bool:
    return (
        not declaration.needs_credentials
        or _selected_credential_metadata(
            query=query,
            tenant_id=tenant_id,
            actor_id=actor_id,
            declaration=declaration,
            credential_id=credential_id,
            workflow_ref=workflow_ref,
            node_id=node_id,
        )
        is not None
    )


def validate_tool_setup(
    *,
    tenant_id: str,
    graph: Mapping[str, Any],
    actor_id: str,
    declarations: DraftToolDeclarations,
    workflow_ref: WorkflowRef | None = None,
) -> None:
    """Refuse uncertainty before native dispatch or any publication writes."""
    nodes = inventory_tool_nodes(graph)
    if not nodes:
        return
    if declarations.tenant_id != tenant_id or not actor_id:
        raise ToolProviderCredentialValidationError("Tool setup requires the acting workspace member.")
    for node in nodes:
        from services.dify_builder.native_launch_observation import observe_resource

        with observe_resource("tool", *tool_key(node["data"]), node_id=node.get("id")):
            _validate_tool_node(
                tenant_id=tenant_id,
                actor_id=actor_id,
                declarations=declarations,
                node=node,
                workflow_ref=workflow_ref,
            )


def _validate_tool_node(
    *,
    tenant_id: str,
    actor_id: str,
    declarations: DraftToolDeclarations,
    node: dict[str, Any],
    workflow_ref: WorkflowRef | None,
) -> None:
    declaration = _find_tool_declaration(declarations.tools, *tool_key(node["data"]))
    if declaration is None:
        _refuse_missing_declaration(declarations, *tool_key(node["data"]))
    if not declaration.needs_credentials:
        return
    # Imported here to keep the application's composition root out of this
    # module's import graph; query sessions are short and metadata-only.
    from extensions.ext_application_services import application_services

    try:
        available = selected_credential_is_available(
            query=application_services().credential_queries,
            tenant_id=tenant_id,
            actor_id=actor_id,
            declaration=declaration,
            credential_id=node["data"].get("credential_id"),
            workflow_ref=workflow_ref,
            node_id=node.get("id"),
        )
    except Exception:
        raise DraftToolSetupError(
            "Tool credential setup could not be verified. "
            "Configure or select credentials before testing or publishing.",
            reason="authorization_lookup_failed",
            node=node,
        ) from None
    if not available:
        raise DraftToolSetupError(
            "Configure or select an authorized Tool credential before testing or publishing.",
            reason="credential_unavailable",
            node=node,
        )


def admit_draft_tool_setup(
    *,
    tenant_id: str,
    graph: Mapping[str, Any],
    actor_id: str,
    workflow_ref: WorkflowRef | None = None,
) -> None:
    """Check fresh setup; only ordinary saved workflow callers supply delegation scope.

    A scope permits repository verification of an exact explicit personal
    credential binding. Builder and discovery callers omit it and stay actor-scoped.
    """
    validate_tool_setup(
        tenant_id=tenant_id,
        graph=graph,
        actor_id=actor_id,
        declarations=prepare_tool_declarations(tenant_id=tenant_id, graph=graph),
        workflow_ref=workflow_ref,
    )


def admit_resumed_draft_tool_setup(
    *,
    workflow_run_id: str,
    workflow_run: WorkflowRun,
    workflow: Workflow,
    app: App,
    user: Account | EndUser,
    generate_entity: AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity,
) -> None:
    """Admit the saved execution graph before cancellation or pause mutations.

    The native generators restore ``WorkflowRun.graph`` using the serialized
    invocation's execution ID. Bind that invocation to the same stored run,
    workflow, app, tenant and acting account before inspecting its saved graph.
    A missing/malformed snapshot cannot fall back to the mutable draft. Normal
    published invocation retains its native delegation. Call after closing the
    resume owner's read session: declaration lookup may perform external I/O.
    """
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
    from models.account import Account
    from models.enums import CreatorUserRole
    from models.workflow import Workflow

    if generate_entity.invoke_from != InvokeFrom.DEBUGGER or Workflow.VERSION_DRAFT not in (
        workflow.version,
        workflow_run.version,
    ):
        return

    config = generate_entity.app_config
    execution_id = (
        generate_entity.workflow_execution_id
        if isinstance(generate_entity, WorkflowAppGenerateEntity)
        else generate_entity.workflow_run_id
    )
    if (
        not isinstance(user, Account)
        or not user.id
        or workflow_run.created_by_role != CreatorUserRole.ACCOUNT
        or workflow_run.created_by != user.id
        or generate_entity.user_id != user.id
        or workflow_run.id != workflow_run_id
        or execution_id != workflow_run.id
        or workflow_run.workflow_id != workflow.id
        or workflow_run.app_id != workflow.app_id
        or workflow.app_id != app.id
        or not app.tenant_id
        or workflow_run.tenant_id != app.tenant_id
        or workflow.tenant_id != app.tenant_id
        or workflow.version != Workflow.VERSION_DRAFT
        or workflow_run.version != Workflow.VERSION_DRAFT
        or config is None
        or config.tenant_id != app.tenant_id
        or config.app_id != app.id
        or config.workflow_id != workflow.id
        or config.app_mode != app.mode
    ):
        raise ToolProviderCredentialValidationError("Saved draft execution does not match its acting account and app.")

    try:
        graph = json.loads(workflow_run.graph) if workflow_run.graph is not None else None
    except (TypeError, ValueError):
        raise ToolProviderCredentialValidationError("Saved draft execution graph could not be verified.") from None
    # Require the native graph containers and node data before the metadata
    # inventory can skip malformed entries. Native owners retain full graph
    # and node-schema validation; this check does not inspect the current draft.
    if (
        not isinstance(graph, dict)
        or not isinstance(nodes := graph.get("nodes"), list)
        or not nodes
        or not isinstance(graph.get("edges"), list)
        or any(
            not isinstance(node, dict)
            or not isinstance(data := node.get("data"), dict)
            or not isinstance(data.get("type"), str)
            or not data["type"]
            for node in nodes
        )
    ):
        raise ToolProviderCredentialValidationError("Saved draft execution graph could not be verified.")
    isolated = generate_entity.single_iteration_run or generate_entity.single_loop_run
    if isolated is not None:
        graph = draft_tool_execution_graph(graph, isolated.node_id)
    ordinary = (
        generate_entity.builder_execution is None
        and generate_entity.builder_agent_execution is None
        and generate_entity.builder_tool_credential_bindings is None
        and generate_entity.builder_expected_revision is None
        and not generate_entity.builder_mocked_node_ids
        and not generate_entity.native_test_required
        and generate_entity.native_test_ref is None
    )
    admit_draft_tool_setup(
        tenant_id=app.tenant_id,
        graph=graph,
        actor_id=user.id,
        workflow_ref=WorkflowRef(app.tenant_id, app.id, workflow.id) if ordinary else None,
    )


@dataclass(frozen=True, slots=True)
class DraftToolRuntimeSelection:
    """Internal Tool-time selection; never supplied by graph data or a client."""

    tenant_id: str
    actor_id: str
    credential: ToolCredentialMetadata | None
    expected_credential_fingerprint: str | None = None
    on_credential_refreshed: Callable[[str], None] | None = None


def prepare_draft_tool_runtime_selection(
    *,
    tenant_id: str,
    app_id: str,
    workflow_id: str | None,
    session_maker: sessionmaker[Session],
    actor_id: str | None,
    invoke_from: object,
    provider: str,
    action: str,
    credential_id: object,
    expected_credential_fingerprint: str | None = None,
    on_credential_refreshed: Callable[[str], None] | None = None,
    node_id: str | None = None,
    allow_workflow_delegation: bool = False,
) -> DraftToolRuntimeSelection | None:
    """Recheck at the actual Tool boundary; published/subworkflow delegation stays native.

    The workflow ID comes only from the native node factory. Inherited debugger
    invocation is insufficient: a workflow Tool may run a published child.
    """
    from sqlalchemy import select

    from core.app.entities.app_invoke_entities import InvokeFrom
    from models.workflow import Workflow

    if workflow_id is None or invoke_from != InvokeFrom.DEBUGGER:
        return None
    try:
        with session_maker() as session:
            version = session.scalar(
                select(Workflow.version).where(
                    Workflow.id == workflow_id,
                    Workflow.tenant_id == tenant_id,
                    Workflow.app_id == app_id,
                )
            )
    except Exception:
        raise ToolProviderCredentialValidationError("Tool workflow scope could not be verified.") from None
    if version is None:
        raise ToolProviderCredentialValidationError("Tool workflow scope could not be verified.")
    if version != Workflow.VERSION_DRAFT:
        return None
    if not actor_id:
        raise ToolProviderCredentialValidationError("Tool setup requires the acting workspace member.")
    graph = {
        "nodes": [
            {
                "data": {
                    "type": "tool",
                    "provider_type": "builtin",
                    "provider_id": provider,
                    "tool_name": action,
                }
            }
        ]
    }
    declarations = prepare_tool_declarations(tenant_id=tenant_id, graph=graph)
    declaration = _find_tool_declaration(declarations.tools, provider, action)
    if declaration is None:
        _refuse_missing_declaration(declarations, provider, action)
    if not declaration.needs_credentials:
        return DraftToolRuntimeSelection(tenant_id, actor_id, None)
    from extensions.ext_application_services import application_services

    try:
        metadata = _selected_credential_metadata(
            query=application_services().credential_queries,
            tenant_id=tenant_id,
            actor_id=actor_id,
            declaration=declaration,
            credential_id=credential_id,
            workflow_ref=WorkflowRef(tenant_id, app_id, workflow_id) if allow_workflow_delegation else None,
            node_id=node_id,
        )
    except Exception:
        raise ToolProviderCredentialValidationError("Tool credential setup could not be verified.") from None
    if metadata is None:
        raise ToolProviderCredentialValidationError("Configure or select an authorized Tool credential before testing.")
    return DraftToolRuntimeSelection(
        tenant_id, actor_id, metadata, expected_credential_fingerprint, on_credential_refreshed
    )


def constrain_draft_tool_credential_read(
    query: Select[tuple[BuiltinToolProvider]],
    selection: DraftToolRuntimeSelection,
    *,
    session: Session,
) -> Select[tuple[BuiltinToolProvider]]:
    """Constrain the native value read itself, closing a revoke race after metadata.

    The metadata check reads no values. Only the native runtime's subsequent
    value read uses this canonical predicate, before its decrypt/OAuth owner.
    """
    from models.credential_permission import CredentialType
    from models.tools import BuiltinToolProvider
    from repositories.credentials.query_repository import apply_credential_visibility_filter_for_actor

    credential = selection.credential
    if credential is None:
        raise ToolProviderCredentialValidationError("Tool credential setup could not be verified.")
    query = query.where(
        BuiltinToolProvider.id == credential.id,
        BuiltinToolProvider.tenant_id == selection.tenant_id,
        BuiltinToolProvider.provider == credential.provider,
    )
    if isinstance(credential, WorkflowToolCredentialMetadata):
        from repositories.credentials.query_repository import workflow_tool_credential_binding_condition

        return query.where(workflow_tool_credential_binding_condition(session, credential))
    return apply_credential_visibility_filter_for_actor(
        query,
        tenant_id=selection.tenant_id,
        model_id_column=BuiltinToolProvider.id,
        model_user_id_column=BuiltinToolProvider.user_id,
        model_visibility_column=BuiltinToolProvider.visibility,
        credential_type=CredentialType.BUILTIN_TOOL_PROVIDER,
        actor_id=selection.actor_id,
    )


def tool_credential_fingerprint(credential: BuiltinToolProvider) -> str:
    """Opaque confirmed account/version binding; encrypted values never leave this owner.

    Include ciphertext because updates can share one database timestamp second.
    This binds the detached native value read before decryption or OAuth refresh.
    """
    return hashlib.sha256(
        f"{credential.id}:{credential.updated_at}:{credential.encrypted_credentials}".encode()
    ).hexdigest()
