from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast

import pytest

from machinery.context import RequestContext
from services.credentials.query import DatasourceCredentialListItem
from services.knowledge.dataset_access import DatasetAccessDeniedError
from services.knowledge.datasets.contracts import RagPipelineDatasetSettings
from services.knowledge.entities.pipeline_workflows import (
    DatasourceNodeRun,
    PipelineFileUpload,
    PipelineInvocationScope,
    PipelineRun,
    PipelineUploadedFile,
    PreparedDatasourceWorkflowNode,
)
from services.knowledge.rag_pipeline.application import (
    PipelineConfigurationError,
    PipelineCredentialGateway,
    PipelineDatasetSettings,
    PipelineWorkflowApplicationService,
    ResolvedDatasourceCredential,
)


def _context() -> RequestContext:
    return RequestContext("request-1", "trace-1", "account-1", "workspace-1")


@dataclass(frozen=True)
class RecordingPipelinePreparation:
    datasource_plugin_specs: Sequence[Mapping[str, object]]


@dataclass(frozen=True)
class RecordingPublication:
    dataset_id: str
    has_published: bool
    dataset_settings: Sequence[RagPipelineDatasetSettings]


@dataclass
class RecordingPipelineOperations:
    calls: list[tuple[str, object]] = field(default_factory=list)
    stored_credential_id: str | None = None
    publication: RecordingPublication | None = None

    def _plugin_spec(self) -> Mapping[str, object]:
        result: dict[str, object] = {
            "node_id": "node-1",
            "provider_name": "notion",
            "plugin_id": "plugin-1",
            "datasource_type": "online_document",
        }
        if self.stored_credential_id is not None:
            result["credential_id"] = self.stored_credential_id
        return result

    def get_pipeline_dataset_id(self, scope: PipelineInvocationScope) -> str:
        self.calls.append(("pipeline_dataset", scope))
        return "dataset-1"

    def list_datasource_plugin_specs(
        self, scope: PipelineInvocationScope, *, is_published: bool
    ) -> Sequence[Mapping[str, object]]:
        self.calls.append(("list_specs", (scope, is_published)))
        return (self._plugin_spec(),)

    def prepare_pipeline(
        self,
        scope: PipelineInvocationScope,
        *,
        command: PipelineRun,
    ) -> RecordingPipelinePreparation:
        self.calls.append(("prepare_pipeline", (scope, command)))
        return RecordingPipelinePreparation((self._plugin_spec(),))

    def run_prepared_pipeline(
        self,
        prepared: object,
        *,
        command: PipelineRun,
    ) -> Mapping[str, object] | Iterable[str]:
        self.calls.append(("run", (prepared, command)))
        return {"batch": "batch-1"}

    def prepare_datasource_node(
        self,
        scope: PipelineInvocationScope,
        *,
        node_id: str,
        command: DatasourceNodeRun,
    ) -> PreparedDatasourceWorkflowNode:
        self.calls.append(("prepare_node", (scope, node_id, command)))
        return PreparedDatasourceWorkflowNode(
            tenant_id=scope.workspace_id,
            account_id=scope.actor_id,
            plugin_id="plugin-1",
            provider_name="notion",
            datasource_name="notion-pages",
            variables_map={},
            user_inputs=command.inputs,
            datasource_type=command.datasource_type,
            credential_id=command.credential_id,
        )

    def run_prepared_datasource_node(
        self, prepared: PreparedDatasourceWorkflowNode, *, credentials: Mapping[str, object]
    ) -> Iterable[str]:
        self.calls.append(("run_node", (prepared, credentials)))
        return iter(("data: complete\n\n",))

    def datasource_error_events(self, message: str) -> Iterable[str]:
        self.calls.append(("node_error", message))
        return iter((f"data: {message}\n\n",))

    def preview_prepared_datasource_node(
        self, prepared: PreparedDatasourceWorkflowNode, *, credentials: Mapping[str, object]
    ) -> Mapping[str, object]:
        self.calls.append(("preview", (prepared, credentials)))
        return {"content": "preview"}

    def upload_file(self, context: RequestContext, *, upload: PipelineFileUpload) -> PipelineUploadedFile:
        self.calls.append(("upload", (context, upload)))
        return PipelineUploadedFile(
            id="file-1",
            name=upload.filename,
            size=len(upload.content),
            extension="txt",
            mime_type=upload.mimetype,
            created_by=context.account_id,
            created_at=datetime(2026, 10, 19, tzinfo=UTC),
        )

    def prepare_workflow_publication(self, scope: PipelineInvocationScope) -> RecordingPublication:
        self.calls.append(("prepare_publication", scope))
        assert self.publication is not None
        return self.publication

    def commit_workflow_publication(self, prepared: object, *, dataset_change: object | None) -> datetime:
        self.calls.append(("commit_publication", (prepared, dataset_change)))
        return datetime(2026, 10, 19, tzinfo=UTC)

    def publish_customized_template(
        self,
        scope: PipelineInvocationScope,
        *,
        values: Mapping[str, object],
    ) -> None:
        self.calls.append(("publish_template", (scope, values)))

    def transform_dataset(self, scope: PipelineInvocationScope) -> Mapping[str, object]:
        self.calls.append(("transform", scope))
        return {"status": "success"}

    def import_dataset(self, context: RequestContext, *, yaml_content: str) -> Mapping[str, object]:
        self.calls.append(("import", (context, yaml_content)))
        return {"status": "completed"}


@dataclass
class RecordingCredentials:
    calls: list[tuple[str, object]] = field(default_factory=list)

    def list_visible(
        self, *, workspace_id: str, actor_id: str, provider: str, plugin_id: str
    ) -> Sequence[DatasourceCredentialListItem]:
        self.calls.append(("list", (workspace_id, actor_id, provider, plugin_id)))
        return (
            DatasourceCredentialListItem(
                id="credential-1",
                name="Personal Notion",
                auth_type="oauth2",
                encrypted_credentials={},
                avatar_url=None,
                is_default=True,
            ),
        )

    def resolve_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
        datasource_type: str,
        credential_id: str | None,
    ) -> ResolvedDatasourceCredential:
        del datasource_type
        self.calls.append(("resolve", (workspace_id, actor_id, provider, plugin_id, credential_id)))
        return ResolvedDatasourceCredential(id=credential_id or "credential-1", values={"token": "actor-secret"})


@dataclass
class RejectingCredentials:
    calls: list[tuple[str, str, str | None]] = field(default_factory=list)

    def list_visible(
        self, *, workspace_id: str, actor_id: str, provider: str, plugin_id: str
    ) -> Sequence[DatasourceCredentialListItem]:
        del workspace_id, actor_id, provider, plugin_id
        return ()

    def resolve_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
        datasource_type: str,
        credential_id: str | None,
    ) -> ResolvedDatasourceCredential:
        del provider, plugin_id, datasource_type
        self.calls.append((workspace_id, actor_id, credential_id))
        raise PipelineConfigurationError("Datasource credential is not available to this actor")


@dataclass
class CredentiallessDatasource:
    calls: list[str | None] = field(default_factory=list)

    def list_visible(
        self, *, workspace_id: str, actor_id: str, provider: str, plugin_id: str
    ) -> Sequence[DatasourceCredentialListItem]:
        del workspace_id, actor_id, provider, plugin_id
        return ()

    def resolve_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        provider: str,
        plugin_id: str,
        datasource_type: str,
        credential_id: str | None,
    ) -> ResolvedDatasourceCredential:
        del workspace_id, actor_id, provider, plugin_id, datasource_type
        self.calls.append(credential_id)
        return ResolvedDatasourceCredential(id=None, values={})


@dataclass
class RecordingDatasetAccess:
    calls: list[tuple[RequestContext, str]] = field(default_factory=list)
    error: Exception | None = None

    def require_accessible(self, context: RequestContext, dataset_id: str) -> object:
        self.calls.append((context, dataset_id))
        if self.error is not None:
            raise self.error
        return object()


@dataclass
class RecordingDatasetSettings:
    initialized: list[str] = field(default_factory=list)
    prepared: object = field(default_factory=object)
    calls: list[tuple[str, object]] = field(default_factory=list)

    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> None:
        del context
        self.initialized.append(dataset_id)

    def prepare_rag_pipeline_dataset_settings(self, context: RequestContext, **kwargs: object) -> object:
        self.calls.append(("prepare", (context, kwargs)))
        return self.prepared


def _service(
    operations: RecordingPipelineOperations,
    credentials: PipelineCredentialGateway,
    *,
    dataset_access: RecordingDatasetAccess | None = None,
    dataset_settings: RecordingDatasetSettings | None = None,
) -> PipelineWorkflowApplicationService:
    return PipelineWorkflowApplicationService(
        operations=operations,
        credentials=credentials,
        dataset_access=dataset_access or RecordingDatasetAccess(),
        dataset_settings=cast("PipelineDatasetSettings", dataset_settings or RecordingDatasetSettings()),
    )


def test_publish_workflow_prepares_dataset_settings_before_committing_snapshot() -> None:
    setting = RagPipelineDatasetSettings(
        chunk_structure="text_model",
        indexing_technique="economy",
        embedding_model_provider=None,
        embedding_model=None,
        keyword_number=10,
        retrieval_model={"search_method": "keyword_search"},
    )
    publication = RecordingPublication(
        dataset_id="dataset-1",
        has_published=True,
        dataset_settings=(setting,),
    )
    operations = RecordingPipelineOperations(publication=publication)
    dataset_settings = RecordingDatasetSettings()
    service = _service(operations, RecordingCredentials(), dataset_settings=dataset_settings)

    created_at = service.publish_workflow(_context(), pipeline_id="pipeline-1")

    assert created_at == datetime(2026, 10, 19, tzinfo=UTC)
    assert [call[0] for call in operations.calls] == [
        "pipeline_dataset",
        "prepare_publication",
        "commit_publication",
    ]
    assert dataset_settings.calls == [
        (
            "prepare",
            (
                _context(),
                {
                    "dataset_id": "dataset-1",
                    "settings": setting,
                    "has_published": True,
                },
            ),
        )
    ]


def test_pipeline_application_preserves_explicit_credentialless_authorization() -> None:
    operations = RecordingPipelineOperations(stored_credential_id="other-member-private")
    credentials = CredentiallessDatasource()
    service = _service(operations, credentials)

    service.run_pipeline(
        _context(),
        dataset_id="dataset-1",
        command=PipelineRun(
            values={
                "inputs": {},
                "datasource_type": "online_document",
                "datasource_info_list": [{"page": {"page_id": "page-1"}}],
                "start_node_id": "node-1",
            },
            is_published=False,
            streaming=False,
        ),
    )

    run_call = cast("tuple[object, PipelineRun]", operations.calls[-1][1])
    assert credentials.calls == ["other-member-private"]
    assert run_call[1].values["datasource_info_list"] == [{"page": {"page_id": "page-1"}, "credential_id": None}]


def test_pipeline_application_service_orchestrates_actor_scoped_credentials() -> None:
    operations = RecordingPipelineOperations()
    credentials = RecordingCredentials()
    service = _service(operations, credentials)
    context = _context()
    node_command = DatasourceNodeRun(
        inputs={"url": "https://example.com"},
        datasource_type="online_document",
        is_published=False,
        credential_id="credential-1",
    )

    plugins = service.list_datasource_plugins(context, dataset_id="dataset-1", is_published=True)
    events = list(service.run_datasource_node(context, dataset_id="dataset-1", node_id="node-1", command=node_command))

    assert plugins[0]["credentials"] == [
        {"id": "credential-1", "name": "Personal Notion", "type": "oauth2", "is_default": True}
    ]
    assert events == ["data: complete\n\n"]
    assert credentials.calls == [
        ("list", ("workspace-1", "account-1", "notion", "plugin-1")),
        ("resolve", ("workspace-1", "account-1", "notion", "plugin-1", "credential-1")),
    ]
    assert [call[0] for call in operations.calls] == ["list_specs", "prepare_node", "run_node"]
    node_call = cast("tuple[object, Mapping[str, object]]", operations.calls[2][1])
    assert node_call[1] == {"token": "actor-secret"}


def test_pipeline_application_service_runs_framework_neutral_pipeline_and_upload_commands() -> None:
    operations = RecordingPipelineOperations()
    service = _service(operations, RecordingCredentials())
    context = _context()
    run_command = PipelineRun(values={"inputs": {}}, is_published=True, streaming=False)
    upload = PipelineFileUpload(filename="notes.txt", content=b"notes", mimetype="text/plain")

    assert service.run_pipeline(context, dataset_id="dataset-1", command=run_command) == {"batch": "batch-1"}
    assert service.upload_file(context, upload=upload).created_by == "account-1"


def test_pipeline_application_service_pins_actor_visible_default_credential_for_runtime() -> None:
    operations = RecordingPipelineOperations()
    service = _service(operations, RecordingCredentials())
    context = _context()
    command = PipelineRun(
        values={
            "inputs": {"query": "hello"},
            "datasource_type": "online_document",
            "datasource_info_list": [{"workspace_id": "remote", "page": {"page_id": "page-1"}}],
            "start_node_id": "node-1",
        },
        is_published=True,
        streaming=False,
    )

    service.run_pipeline(context, dataset_id="dataset-1", command=command)

    run_call = cast("tuple[object, PipelineRun]", operations.calls[-1][1])
    run_command = run_call[1]
    assert isinstance(run_command, PipelineRun)
    assert run_command.values["datasource_info_list"] == [
        {
            "workspace_id": "remote",
            "page": {"page_id": "page-1"},
            "credential_id": "credential-1",
        }
    ]


def test_pipeline_rejects_datasource_type_that_does_not_match_the_selected_node() -> None:
    operations = RecordingPipelineOperations()
    credentials = RecordingCredentials()
    service = _service(operations, credentials)

    with pytest.raises(PipelineConfigurationError, match="does not match"):
        service.run_pipeline(
            _context(),
            dataset_id="dataset-1",
            command=PipelineRun(
                values={
                    "inputs": {},
                    "datasource_type": "online_drive",
                    "datasource_info_list": [{"id": "remote-file"}],
                    "start_node_id": "node-1",
                },
                is_published=True,
                streaming=False,
            ),
        )

    assert credentials.calls == []
    assert [name for name, _value in operations.calls] == ["prepare_pipeline"]


def test_console_pipeline_authorizes_stored_credential_from_the_fixed_workflow() -> None:
    operations = RecordingPipelineOperations(stored_credential_id="credential-1")
    credentials = RecordingCredentials()
    service = _service(operations, credentials)
    command = PipelineRun(
        values={
            "inputs": {"query": "hello"},
            "datasource_type": "online_document",
            "datasource_info_list": [{"workspace_id": "remote", "page": {"page_id": "page-1"}}],
            "start_node_id": "node-1",
        },
        is_published=False,
        streaming=True,
    )

    service.run_console_pipeline(
        workspace_id="workspace-1",
        actor_id="account-1",
        pipeline_id="pipeline-1",
        command=command,
    )
    listed = service.list_datasource_plugins(_context(), dataset_id="dataset-1", is_published=False)

    assert credentials.calls[0] == (
        "resolve",
        ("workspace-1", "account-1", "notion", "plugin-1", "credential-1"),
    )
    run_call = cast("tuple[object, PipelineRun]", next(value for name, value in operations.calls if name == "run"))
    assert run_call[1].values["datasource_info_list"] == [
        {
            "workspace_id": "remote",
            "page": {"page_id": "page-1"},
            "credential_id": "credential-1",
        }
    ]
    assert "credential_id" not in listed[0]


def test_console_pipeline_rejects_stored_credential_hidden_from_actor() -> None:
    operations = RecordingPipelineOperations(stored_credential_id="other-member-private")
    credentials = RejectingCredentials()
    service = _service(operations, credentials)

    with pytest.raises(PipelineConfigurationError, match="not available"):
        service.run_console_pipeline(
            workspace_id="workspace-1",
            actor_id="account-1",
            pipeline_id="pipeline-1",
            command=PipelineRun(
                values={
                    "inputs": {"query": "hello"},
                    "datasource_type": "online_document",
                    "datasource_info_list": [{"page": {"page_id": "page-1"}}],
                    "start_node_id": "node-1",
                },
                is_published=True,
                streaming=False,
            ),
        )

    assert credentials.calls == [("workspace-1", "account-1", "other-member-private")]
    assert not any(name == "run" for name, _value in operations.calls)


def test_all_interactive_entrypoints_reject_another_members_private_credential() -> None:
    operations = RecordingPipelineOperations()
    credentials = RejectingCredentials()
    service = _service(operations, credentials)
    context = _context()
    empty_inputs: dict[str, object] = {}
    pipeline_values: dict[str, object] = {
        "inputs": empty_inputs,
        "datasource_type": "online_document",
        "datasource_info_list": [
            {
                "workspace_id": "remote",
                "page": {"page_id": "page-1"},
                "credential_id": "other-member-private",
            }
        ],
        "start_node_id": "node-1",
    }

    with pytest.raises(PipelineConfigurationError, match="not available"):
        service.run_pipeline(
            context,
            dataset_id="dataset-1",
            command=PipelineRun(values=pipeline_values, is_published=True, streaming=False),
        )
    for is_published in (False, True):
        with pytest.raises(PipelineConfigurationError, match="not available"):
            service.run_console_pipeline(
                workspace_id="workspace-1",
                actor_id="account-1",
                pipeline_id="pipeline-1",
                command=PipelineRun(values=pipeline_values, is_published=is_published, streaming=False),
            )

    for is_published, console in ((False, False), (True, False), (False, True), (True, True)):
        command = DatasourceNodeRun(
            inputs={},
            datasource_type="online_document",
            is_published=is_published,
            credential_id="other-member-private",
        )
        events = (
            service.run_console_datasource_node(
                workspace_id="workspace-1",
                actor_id="account-1",
                pipeline_id="pipeline-1",
                node_id="node-1",
                command=command,
            )
            if console
            else service.run_datasource_node(context, dataset_id="dataset-1", node_id="node-1", command=command)
        )
        assert "not available" in next(iter(events))

    with pytest.raises(PipelineConfigurationError, match="not available"):
        service.preview_console_datasource_node(
            context,
            pipeline_id="pipeline-1",
            node_id="node-1",
            command=DatasourceNodeRun(
                inputs={},
                datasource_type="online_document",
                is_published=True,
                credential_id="other-member-private",
            ),
        )

    assert all(call == ("workspace-1", "account-1", "other-member-private") for call in credentials.calls)
    assert not any(name in {"run", "run_node", "preview"} for name, _value in operations.calls)


def test_console_preview_requires_access_to_pipeline_dataset_before_preparation() -> None:
    operations = RecordingPipelineOperations()
    access = RecordingDatasetAccess(error=DatasetAccessDeniedError())
    service = _service(operations, RecordingCredentials(), dataset_access=access)
    context = _context()

    with pytest.raises(DatasetAccessDeniedError):
        service.preview_console_datasource_node(
            context,
            pipeline_id="pipeline-1",
            node_id="node-1",
            command=DatasourceNodeRun(
                inputs={},
                datasource_type="online_document",
                is_published=True,
            ),
        )

    assert access.calls == [(context, "dataset-1")]
    assert [name for name, _value in operations.calls] == ["pipeline_dataset"]
