"""Published Installed App authorization using member-visible Workspace credentials.

Transport vocabulary matches Web Apps; ownership and execution are deliberately
separate. Saved selections never grant access and never contain credential values.
"""

import time
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Protocol
from uuid import UUID

from clients.plugin.auth_entities import CredentialCheckResult
from context.connection_execution import (
    ConnectionExecutionContext,
    ExecutionConnectionSelection,
    WorkspaceConnectionScope,
)
from models.provider_ids import ToolProviderID
from services.app_definition_query_service import AppDefinitionQueryService, AppDefinitionUnavailableError
from services.end_user_connections.contracts import ConnectionPage, ConnectionSummary
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionRequiredError,
    ConnectionRevisionChangedError,
)
from services.end_user_connections.execution import ConnectionRunInput
from services.end_user_connections.preflight import (
    ConnectionPreflightInput,
    ConnectionPreflightStatus,
    ConnectionPreflightView,
)
from services.end_user_connections.selections import ConnectionConfiguration, SaveConnectionConfigurationInput
from services.installed_app_access_service import (
    InstalledAppAccessDeniedError,
    InstalledAppAccessService,
    InstalledAppNotFoundError,
    InstalledAppRef,
)
from services.webapp_access_query_service import WebAppAccessUnavailableError
from services.workflow_test_credential_adapters import DraftTestCredentialPlanner
from services.workflow_test_credentials import (
    BuilderScope,
    ResolvedTestCredential,
    TestCredentialGateway,
    TestCredentialRequirement,
    TestCredentialUnavailableError,
)


@dataclass(frozen=True)
class InstalledConnectionGraph:
    installation: InstalledAppRef
    workflow_id: str
    graph: Mapping[str, Any]


@dataclass(frozen=True)
class InstalledConnectionConfiguration:
    connection_revision: str
    connections: Mapping[str, str | None]


class InstalledConnectionStore(Protocol):
    def graph(
        self, scope: WorkspaceConnectionScope, *, workflow_id: str | None = None, conversation_id: str | None = None
    ) -> InstalledConnectionGraph: ...

    def connections(
        self, scope: WorkspaceConnectionScope, providers: tuple[str, ...]
    ) -> tuple[ConnectionSummary, ...]: ...

    def configuration(
        self, scope: WorkspaceConnectionScope, conversation_id: str | None
    ) -> InstalledConnectionConfiguration | None: ...

    def save(
        self,
        scope: WorkspaceConnectionScope,
        graph: InstalledConnectionGraph,
        configuration: InstalledConnectionConfiguration,
        conversation_id: str | None,
    ) -> None: ...


class InstalledAppConnectionService:
    def __init__(
        self,
        *,
        store: InstalledConnectionStore,
        access: InstalledAppAccessService,
        definitions: AppDefinitionQueryService,
        credentials: TestCredentialGateway,
    ) -> None:
        self._store = store
        self._access = access
        self._definitions = definitions
        self._planner = DraftTestCredentialPlanner()
        self._credentials = credentials

    def _requirements(
        self, graph: Mapping[str, Any], node_id: str | None = None
    ) -> tuple[TestCredentialRequirement, ...]:
        return tuple(
            replace(item, provider=str(ToolProviderID(item.provider)))
            for item in self._planner.requirements(graph, node_id)
        )

    def _graph(
        self, scope: WorkspaceConnectionScope, *, workflow_id: str | None = None, conversation_id: str | None = None
    ) -> InstalledConnectionGraph:
        try:
            self._access.get_access(
                installed_app_id=scope.installed_app_id, tenant_id=scope.tenant_id, account_id=scope.account_id
            )
        except (InstalledAppAccessDeniedError, InstalledAppNotFoundError):
            raise ConnectionIdentityError() from None
        except WebAppAccessUnavailableError:
            raise ConnectionCheckUnavailableError() from None
        return self._store.graph(scope, workflow_id=workflow_id, conversation_id=conversation_id)

    def _parameters(self, graph: InstalledConnectionGraph) -> Mapping[str, Any]:
        try:
            return self._definitions.get_web_parameters(
                graph.installation.app_id, graph.installation.app_owner_tenant_id
            )
        except AppDefinitionUnavailableError:
            raise ConnectionCheckUnavailableError() from None

    def _require_revision(self, graph: InstalledConnectionGraph, revision: str) -> None:
        current = self._parameters(graph)["connection_revision"]
        if current != revision:
            raise ConnectionRevisionChangedError(current_revision=current)

    def list_connections(
        self, scope: WorkspaceConnectionScope, *, provider: str | None, cursor: str | None, limit: int
    ) -> ConnectionPage:
        graph = self._graph(scope)
        providers = tuple(dict.fromkeys(item.provider for item in self._requirements(graph.graph)))
        if provider is not None:
            providers = tuple(value for value in providers if value == provider)
        after = str(UUID(cursor)) if cursor is not None else None
        rows = sorted(self._store.connections(scope, providers), key=lambda item: item.id)
        rows = [item for item in rows if after is None or item.id > after]
        data = tuple(rows[:limit])
        return ConnectionPage(data=data, next_cursor=data[-1].id if len(rows) > limit else None)

    def configuration(self, scope: WorkspaceConnectionScope, conversation_id: str | None) -> ConnectionConfiguration:
        graph = self._graph(scope, conversation_id=conversation_id)
        saved = self._store.configuration(scope, conversation_id)
        requirements = self._requirements(graph.graph)
        summaries = {
            item.id: item for item in self._store.connections(scope, tuple(item.provider for item in requirements))
        }
        return ConnectionConfiguration(
            connections={
                key: summaries.get(value) if value else None
                for key, value in (saved.connections if saved else {}).items()
            },
            reauthorization_required=bool(requirements)
            and (saved is None or saved.connection_revision != self._parameters(graph)["connection_revision"]),
        )

    def _selected(
        self, graph: InstalledConnectionGraph, selections: Mapping[str, Any]
    ) -> tuple[TestCredentialRequirement, ...]:
        requirements = self._requirements(graph.graph)
        if selections.keys() - {item.node_id for item in requirements}:
            raise ConnectionConfigurationError()
        return tuple(
            replace(item, credential_id=str(selections[item.node_id]) if selections.get(item.node_id) else None)
            for item in requirements
        )

    def save_configuration(
        self, scope: WorkspaceConnectionScope, command: SaveConnectionConfigurationInput
    ) -> ConnectionConfiguration:
        conversation_id = str(command.conversation_id) if command.conversation_id else None
        graph = self._graph(scope, conversation_id=conversation_id)
        self._require_revision(graph, command.connection_revision)
        selected = self._selected(graph, command.connections)
        summaries = {
            item.id: item for item in self._store.connections(scope, tuple(item.provider for item in selected))
        }
        for requirement in selected:
            if requirement.credential_id is None:
                continue
            record = summaries.get(requirement.credential_id)
            if record is None:
                raise ConnectionNotFoundError()
            if record.provider != requirement.provider or record.credential_type.value not in requirement.allowed_types:
                raise ConnectionConfigurationError()
        self._require_revision(graph, command.connection_revision)
        self._store.save(
            scope,
            graph,
            InstalledConnectionConfiguration(
                command.connection_revision,
                {key: str(value) if value else None for key, value in command.connections.items()},
            ),
            conversation_id,
        )
        return self.configuration(scope, conversation_id)

    def preflight(self, scope: WorkspaceConnectionScope, command: ConnectionPreflightInput) -> ConnectionPreflightView:
        """Check explicit, member-visible credentials for the admitted publication.

        Match EndUser check semantics: valid and unsupported checks permit use,
        invalid checks reject credentials, and transient failures leave availability
        unknown. Recheck access and publication after external I/O, without saving
        selections or exposing runtime secrets.
        """
        conversation_id = str(command.conversation_id) if command.conversation_id else None
        graph = self._graph(scope, conversation_id=conversation_id)
        self._require_revision(graph, command.connection_revision)
        states = []
        for requirement in self._selected(graph, command.connections):
            check = None
            status = "disconnected"
            connection_id = requirement.credential_id
            if connection_id is not None:
                try:
                    resolved = self._credentials.resolve(
                        BuilderScope(scope.tenant_id, graph.installation.app_id, scope.account_id), requirement
                    )
                    check = CredentialCheckResult.model_validate(
                        {**resolved.check.model_dump(), "checked_at": int(time.time())}
                    )
                    status = "connected" if check.status in {"valid", "unsupported"} else check.status
                except TestCredentialUnavailableError as error:
                    status = error.status
                if status == "temporarily_unavailable" and check is None:
                    check = CredentialCheckResult(
                        status="temporarily_unavailable",
                        reason_code="provider_unavailable",
                        retryable=True,
                        checked_at=int(time.time()),
                    )
                if status == "disconnected":
                    connection_id = None
            states.append(
                ConnectionPreflightStatus(
                    node_id=requirement.node_id,
                    provider=requirement.provider,
                    connection_id=connection_id,
                    status=None
                    if status == "temporarily_unavailable"
                    else "invalid"
                    if status == "incompatible"
                    else status,
                    check=check,
                )
            )
        self._graph(scope, workflow_id=graph.workflow_id, conversation_id=conversation_id)
        self._require_revision(graph, command.connection_revision)
        return ConnectionPreflightView(
            workflow_id=graph.workflow_id, connection_revision=command.connection_revision, connections=tuple(states)
        )

    def prepare(
        self, scope: WorkspaceConnectionScope, *, workflow_id: str, args: Mapping[str, Any]
    ) -> ConnectionExecutionContext | None:
        conversation_id = args.get("conversation_id") or None
        graph = self._graph(scope, workflow_id=workflow_id, conversation_id=conversation_id)
        command = ConnectionRunInput.model_validate(args)
        if not self._requirements(graph.graph):
            if command.connections:
                raise ConnectionConfigurationError()
            return None
        if command.connection_revision is None:
            raise ConnectionConfigurationError()
        if "connections" not in args and conversation_id is not None:
            saved = self._store.configuration(scope, conversation_id)
            if saved is None or saved.connection_revision != command.connection_revision:
                raise ConnectionRevisionChangedError()
            command = command.model_copy(update={"connections": saved.connections})
        assert command.connection_revision is not None
        result = self.preflight(
            scope,
            ConnectionPreflightInput(
                connection_revision=command.connection_revision,
                conversation_id=conversation_id,
                connections=command.connections or {},
            ),
        )
        for state in result.connections:
            if state.status == "disconnected":
                if (command.connections or {}).get(state.node_id):
                    raise ConnectionNotFoundError()
                raise ConnectionRequiredError()
            if state.status == "reconnect_required":
                raise ConnectionReauthorizationRequiredError()
            if state.status == "invalid":
                raise ConnectionInvalidCredentialsError()
            if state.status is None:
                raise ConnectionCheckUnavailableError()
        return ConnectionExecutionContext(
            tenant_id=graph.installation.app_owner_tenant_id,
            app_id=graph.installation.app_id,
            end_user_id="",
            account_id=scope.account_id,
            workspace=scope,
            workflow_id=workflow_id,
            connection_revision=result.connection_revision,
            selections=tuple(
                ExecutionConnectionSelection(
                    node_id=item.node_id, provider=item.provider, connection_id=item.connection_id
                )
                for item in result.connections
            ),
        )

    def validate_execution(
        self,
        context: ConnectionExecutionContext,
        *,
        app_id: str,
        tenant_id: str,
        account_id: str,
        workflow_id: str,
        conversation_id: str | None,
    ) -> InstalledConnectionGraph:
        scope = context.workspace
        if (
            scope is None
            or scope.account_id != account_id
            or context.account_id != account_id
            or context.end_user_id
            or context.app_id != app_id
            or context.tenant_id != tenant_id
            or context.workflow_id != workflow_id
        ):
            raise ConnectionConfigurationError()
        graph = self._graph(scope, workflow_id=workflow_id, conversation_id=conversation_id)
        if graph.installation.app_id != app_id or graph.installation.app_owner_tenant_id != tenant_id:
            raise ConnectionConfigurationError()
        self._require_revision(graph, context.connection_revision)
        requirements = {item.node_id: item for item in self._requirements(graph.graph)}
        if (
            len(context.selections) != len(requirements)
            or {item.node_id for item in context.selections} != requirements.keys()
        ):
            raise ConnectionConfigurationError()
        visible = {
            item.id: item
            for item in self._store.connections(scope, tuple(item.provider for item in requirements.values()))
        }
        for selection in context.selections:
            requirement = requirements[selection.node_id]
            record = visible.get(selection.connection_id) if selection.connection_id is not None else None
            if record is None:
                raise ConnectionNotFoundError()
            if (
                selection.provider != requirement.provider
                or record.provider != requirement.provider
                or record.credential_type.value not in requirement.allowed_types
            ):
                raise ConnectionConfigurationError()
        return graph

    def resolve(
        self, context: ConnectionExecutionContext, *, account_id: str, node_id: str, graph: Mapping[str, Any]
    ) -> ResolvedTestCredential:
        """Resolve a selected credential against the current authorized graph.

        Return process-local secrets after a valid or unsupported provider check
        and access/revision rechecks, matching EndUser readiness. Transient checks
        fail as unavailable; invalid credentials fail without changing selections.
        """
        current = self.validate_execution(
            context,
            app_id=context.app_id,
            tenant_id=context.tenant_id,
            account_id=account_id,
            workflow_id=context.workflow_id,
            conversation_id=None,
        )
        if graph != current.graph:
            raise ConnectionRevisionChangedError()
        selected = {item.node_id: item.connection_id for item in context.selections}
        requirements = self._requirements(graph, node_id)
        if len(requirements) != 1:
            raise ConnectionConfigurationError()
        requirement = requirements[0]
        connection_id = selected.get(requirement.node_id)
        if connection_id is None:
            raise ConnectionRequiredError()
        result = self._credentials.resolve(
            BuilderScope(context.tenant_id, context.app_id, account_id),
            replace(requirement, credential_id=connection_id),
        )
        self._require_revision(current, context.connection_revision)
        assert context.workspace is not None
        self._graph(context.workspace, workflow_id=context.workflow_id)
        if result.check.status == "temporarily_unavailable":
            raise ConnectionCheckUnavailableError()
        if result.check.status == "invalid":
            raise ConnectionInvalidCredentialsError()
        return result
