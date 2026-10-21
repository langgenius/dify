"""Application orchestration for Service API knowledge pipeline workflows."""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from machinery.context import RequestContext
from services.credentials.query import DatasourceCredentialListItem
from services.knowledge.datasets.contracts import (
    PreparedRagPipelineDatasetUpdate,
    RagPipelineDatasetSettings,
)
from services.knowledge.entities.pipeline_workflows import (
    DatasourceNodeRun,
    PipelineFileUpload,
    PipelineInvocationScope,
    PipelineRun,
    PipelineUploadedFile,
    PreparedDatasourceWorkflowNode,
)


class PipelineWorkflowError(Exception):
    """Base error for knowledge pipeline workflow use cases."""


class PipelineDatasetNotFoundError(PipelineWorkflowError):
    def __init__(self) -> None:
        super().__init__("Dataset not found")


class PipelineNotFoundError(PipelineWorkflowError):
    def __init__(self) -> None:
        super().__init__("Pipeline not found")


class PipelineActorNotFoundError(PipelineWorkflowError):
    def __init__(self) -> None:
        super().__init__("Pipeline actor not found")


class PipelineConfigurationError(PipelineWorkflowError):
    """The persisted pipeline cannot be executed as configured."""


class PreparedPipelineWorkflow(Protocol):
    @property
    def datasource_plugin_specs(self) -> Sequence[Mapping[str, Any]]: ...


class PreparedWorkflowPublication(Protocol):
    @property
    def dataset_id(self) -> str: ...

    @property
    def has_published(self) -> bool: ...

    @property
    def dataset_settings(self) -> Sequence[RagPipelineDatasetSettings]: ...


class PipelineDatasetSettings(Protocol):
    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> None: ...

    def prepare_rag_pipeline_dataset_settings(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        settings: RagPipelineDatasetSettings,
        has_published: bool,
    ) -> PreparedRagPipelineDatasetUpdate: ...


class PipelineWorkflowOperations(Protocol):
    def get_pipeline_dataset_id(self, scope: PipelineInvocationScope) -> str: ...

    def list_datasource_plugin_specs(
        self, scope: PipelineInvocationScope, *, is_published: bool
    ) -> Sequence[Mapping[str, Any]]: ...

    def prepare_pipeline(
        self,
        scope: PipelineInvocationScope,
        *,
        command: PipelineRun,
    ) -> PreparedPipelineWorkflow: ...

    def run_prepared_pipeline(
        self,
        prepared: PreparedPipelineWorkflow,
        *,
        command: PipelineRun,
    ) -> Mapping[str, Any] | Iterable[str]: ...

    def prepare_datasource_node(
        self,
        scope: PipelineInvocationScope,
        *,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> PreparedDatasourceWorkflowNode: ...

    def run_prepared_datasource_node(
        self,
        prepared: PreparedDatasourceWorkflowNode,
        *,
        credentials: Mapping[str, object],
    ) -> Iterable[str]: ...

    def datasource_error_events(self, message: str) -> Iterable[str]: ...

    def preview_prepared_datasource_node(
        self,
        prepared: PreparedDatasourceWorkflowNode,
        *,
        credentials: Mapping[str, object],
    ) -> Mapping[str, Any]: ...

    def upload_file(self, context: RequestContext, *, upload: PipelineFileUpload) -> PipelineUploadedFile: ...

    def prepare_workflow_publication(self, scope: PipelineInvocationScope) -> PreparedWorkflowPublication: ...

    def commit_workflow_publication(
        self,
        prepared: PreparedWorkflowPublication,
        *,
        dataset_change: PreparedRagPipelineDatasetUpdate | None,
    ) -> datetime: ...

    def publish_customized_template(
        self,
        scope: PipelineInvocationScope,
        *,
        values: Mapping[str, Any],
    ) -> None: ...

    def transform_dataset(self, scope: PipelineInvocationScope) -> Mapping[str, Any]: ...

    def import_dataset(self, context: RequestContext, *, yaml_content: str) -> Mapping[str, Any]: ...


class PipelineCredentialGateway(Protocol):
    """Actor-scoped datasource credentials used by interactive pipeline calls."""

    def list_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
    ) -> Sequence[DatasourceCredentialListItem]: ...

    def resolve_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
        datasource_type: str,
        credential_id: str | None,
    ) -> "ResolvedDatasourceCredential": ...


class PipelineDatasetAccess(Protocol):
    """Authorize the dataset linked to a Console pipeline."""

    def require_accessible(self, context: RequestContext, dataset_id: str) -> object: ...


@dataclass(frozen=True, slots=True)
class ResolvedDatasourceCredential:
    id: str | None
    values: Mapping[str, object]


class PipelineWorkflowApplicationService:
    def __init__(
        self,
        *,
        operations: PipelineWorkflowOperations,
        credentials: PipelineCredentialGateway,
        dataset_access: PipelineDatasetAccess,
        dataset_settings: PipelineDatasetSettings,
    ) -> None:
        self._operations = operations
        self._credentials = credentials
        self._dataset_access = dataset_access
        self._dataset_settings = dataset_settings

    def list_datasource_plugins(
        self, context: RequestContext, *, dataset_id: str, is_published: bool
    ) -> Sequence[Mapping[str, Any]]:
        scope = self._dataset_scope(context, dataset_id)
        plugins = self._operations.list_datasource_plugin_specs(
            scope,
            is_published=is_published,
        )
        result: list[Mapping[str, Any]] = []
        for plugin in plugins:
            provider_name, plugin_id = self._provider_identity(plugin)
            public_plugin = {key: value for key, value in plugin.items() if key != "credential_id"}
            credentials = self._credentials.list_visible(
                workspace_id=context.active_workspace_id,
                actor_id=context.account_id,
                provider=provider_name,
                plugin_id=plugin_id,
            )
            result.append(
                {
                    **public_plugin,
                    "credentials": [
                        {
                            "id": credential.id,
                            "name": credential.name,
                            "type": credential.auth_type,
                            "is_default": credential.is_default,
                        }
                        for credential in credentials
                    ],
                }
            )
        return result

    def run_datasource_node(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> Iterable[str]:
        return self._run_datasource_node(
            self._dataset_scope(context, dataset_id),
            node_id=node_id,
            command=command,
        )

    def run_console_datasource_node(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        pipeline_id: str,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> Iterable[str]:
        return self._run_datasource_node(
            PipelineInvocationScope(workspace_id=workspace_id, actor_id=actor_id, pipeline_id=pipeline_id),
            node_id=node_id,
            command=command,
        )

    def _run_datasource_node(
        self,
        scope: PipelineInvocationScope,
        *,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> Iterable[str]:
        try:
            prepared = self._operations.prepare_datasource_node(
                scope,
                node_id=node_id,
                command=command,
            )
            credential = self._credentials.resolve_visible(
                workspace_id=scope.workspace_id,
                actor_id=scope.actor_id,
                provider=prepared.provider_name,
                plugin_id=prepared.plugin_id,
                datasource_type=prepared.datasource_type,
                credential_id=command.credential_id,
            )
        except (PipelineDatasetNotFoundError, PipelineNotFoundError, PipelineActorNotFoundError):
            raise
        except Exception as error:
            return self._operations.datasource_error_events(str(error))
        return self._operations.run_prepared_datasource_node(prepared, credentials=credential.values)

    def run_pipeline(
        self, context: RequestContext, *, dataset_id: str, command: PipelineRun
    ) -> Mapping[str, Any] | Iterable[str]:
        return self._run_pipeline(self._dataset_scope(context, dataset_id), command=command)

    def run_console_pipeline(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        pipeline_id: str,
        command: PipelineRun,
    ) -> Mapping[str, Any] | Iterable[str]:
        return self._run_pipeline(
            PipelineInvocationScope(workspace_id=workspace_id, actor_id=actor_id, pipeline_id=pipeline_id),
            command=command,
        )

    def _run_pipeline(
        self,
        scope: PipelineInvocationScope,
        *,
        command: PipelineRun,
    ) -> Mapping[str, Any] | Iterable[str]:
        prepared = self._operations.prepare_pipeline(scope, command=command)
        authorized = self._authorize_pipeline_credentials(
            scope,
            datasource_plugins=prepared.datasource_plugin_specs,
            command=command,
        )
        return self._operations.run_prepared_pipeline(prepared, command=authorized)

    def preview_console_datasource_node(
        self,
        context: RequestContext,
        *,
        pipeline_id: str,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> Mapping[str, Any]:
        scope = PipelineInvocationScope(
            workspace_id=context.active_workspace_id,
            actor_id=context.account_id,
            pipeline_id=pipeline_id,
        )
        dataset_id = self._operations.get_pipeline_dataset_id(scope)
        self._dataset_access.require_accessible(context, dataset_id)
        prepared = self._operations.prepare_datasource_node(scope, node_id=node_id, command=command)
        credential = self._credentials.resolve_visible(
            workspace_id=scope.workspace_id,
            actor_id=scope.actor_id,
            provider=prepared.provider_name,
            plugin_id=prepared.plugin_id,
            datasource_type=prepared.datasource_type,
            credential_id=command.credential_id,
        )
        return self._operations.preview_prepared_datasource_node(prepared, credentials=credential.values)

    def upload_file(self, context: RequestContext, *, upload: PipelineFileUpload) -> PipelineUploadedFile:
        return self._operations.upload_file(context, upload=upload)

    def publish_workflow(self, context: RequestContext, *, pipeline_id: str) -> datetime:
        scope = self._authorized_pipeline_scope(context, pipeline_id)
        prepared = self._operations.prepare_workflow_publication(scope)
        settings = tuple(
            setting
            for index, setting in enumerate(prepared.dataset_settings)
            if setting not in prepared.dataset_settings[:index]
        )
        if len(settings) > 1:
            raise PipelineConfigurationError("A pipeline cannot publish conflicting knowledge index settings")
        dataset_change = (
            self._dataset_settings.prepare_rag_pipeline_dataset_settings(
                context,
                dataset_id=prepared.dataset_id,
                settings=settings[0],
                has_published=prepared.has_published,
            )
            if settings
            else None
        )
        return self._operations.commit_workflow_publication(prepared, dataset_change=dataset_change)

    def publish_customized_template(
        self,
        context: RequestContext,
        *,
        pipeline_id: str,
        values: Mapping[str, Any],
    ) -> None:
        scope = self._authorized_pipeline_scope(context, pipeline_id)
        self._operations.publish_customized_template(scope, values=values)

    def transform_dataset(self, context: RequestContext, *, dataset_id: str) -> Mapping[str, Any]:
        scope = self._dataset_scope(context, dataset_id)
        return self._operations.transform_dataset(scope)

    def import_dataset(self, context: RequestContext, *, yaml_content: str) -> Mapping[str, Any]:
        result = self._operations.import_dataset(context, yaml_content=yaml_content)
        dataset_id = result.get("dataset_id")
        if isinstance(dataset_id, str) and dataset_id:
            self._dataset_settings.initialize_creator_access(context, dataset_id=dataset_id)
        return result

    def _authorized_pipeline_scope(self, context: RequestContext, pipeline_id: str) -> PipelineInvocationScope:
        scope = PipelineInvocationScope(
            workspace_id=context.active_workspace_id,
            actor_id=context.account_id,
            pipeline_id=pipeline_id,
        )
        dataset_id = self._operations.get_pipeline_dataset_id(scope)
        self._dataset_access.require_accessible(context, dataset_id)
        return scope

    @staticmethod
    def _provider_identity(plugin: Mapping[str, Any]) -> tuple[str, str]:
        provider_name = plugin.get("provider_name")
        plugin_id = plugin.get("plugin_id")
        if not isinstance(provider_name, str) or not provider_name or not isinstance(plugin_id, str) or not plugin_id:
            raise PipelineConfigurationError("Datasource provider configuration is incomplete")
        return provider_name, plugin_id

    def _authorize_pipeline_credentials(
        self,
        scope: PipelineInvocationScope,
        *,
        datasource_plugins: Sequence[Mapping[str, Any]],
        command: PipelineRun,
    ) -> PipelineRun:
        requested_datasource_type = command.values.get("datasource_type")
        if requested_datasource_type not in {"online_document", "online_drive"}:
            return command
        start_node_id = command.values.get("start_node_id")
        plugin = next((item for item in datasource_plugins if item.get("node_id") == start_node_id), None)
        if plugin is None:
            raise PipelineConfigurationError("Datasource node data not found")
        provider_name, plugin_id = self._provider_identity(plugin)
        configured_datasource_type = plugin.get("datasource_type")
        if not isinstance(configured_datasource_type, str) or not configured_datasource_type:
            raise PipelineConfigurationError("Datasource provider type is missing")
        if configured_datasource_type != requested_datasource_type:
            raise PipelineConfigurationError("Datasource type does not match the configured node")
        datasource_info = command.values.get("datasource_info_list")
        if not isinstance(datasource_info, list):
            raise PipelineConfigurationError("Datasource information list is required")

        authorized_info: list[Mapping[str, Any]] = []
        stored_credential_id = plugin.get("credential_id")
        if stored_credential_id is not None and not isinstance(stored_credential_id, str):
            raise PipelineConfigurationError("Datasource credential ID is invalid")
        for item in datasource_info:
            if not isinstance(item, Mapping):
                raise PipelineConfigurationError("Datasource information is invalid")
            requested_id = item.get("credential_id")
            if requested_id is not None and not isinstance(requested_id, str):
                raise PipelineConfigurationError("Datasource credential ID is invalid")
            if requested_id is None:
                requested_id = stored_credential_id
            credential = self._credentials.resolve_visible(
                workspace_id=scope.workspace_id,
                actor_id=scope.actor_id,
                provider=provider_name,
                plugin_id=plugin_id,
                datasource_type=configured_datasource_type,
                credential_id=requested_id,
            )
            authorized_item = dict(item)
            if credential.id is None:
                # Preserve the explicit no-credential authorization decision for
                # the runtime boundary.  Absence still means that older callers
                # may resolve the credential stored on the workflow node.
                authorized_item["credential_id"] = None
            else:
                authorized_item["credential_id"] = credential.id
            authorized_info.append(authorized_item)

        return PipelineRun(
            values={**command.values, "datasource_info_list": authorized_info},
            is_published=command.is_published,
            streaming=command.streaming,
        )

    @staticmethod
    def _dataset_scope(context: RequestContext, dataset_id: str) -> PipelineInvocationScope:
        return PipelineInvocationScope(
            workspace_id=context.active_workspace_id,
            actor_id=context.account_id,
            dataset_id=dataset_id,
        )
