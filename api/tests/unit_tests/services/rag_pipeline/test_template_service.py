from dataclasses import dataclass, field

import pytest
import yaml
from pytest_mock import MockerFixture
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from machinery.context import RequestContext
from models.account import Account
from models.dataset import Dataset, Pipeline, PipelineCustomizedTemplate
from models.dataset import PermissionEnum as DatasetPermissionEnum
from models.workflow import Workflow
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.pipeline_template_repository import PipelineTemplateRepository
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetAccessService
from services.knowledge.pipeline_templates.adapters import PipelineTemplateCatalogAdapter, PipelineTemplateDslExporter
from services.knowledge.pipeline_templates.application import (
    PipelineTemplateInput,
    PipelineTemplateNameConflictError,
    PipelineTemplateNotFoundError,
    PipelineTemplatePublishForbiddenError,
    PipelineTemplateService,
)

CONTEXT = RequestContext("request-1", None, "account-1", "tenant-1")
TEMPLATE = PipelineTemplateInput("Template", "Description", {"icon": "book"})


class EditorRole:
    def get_legacy_role(self, *, workspace_id: str, account_id: str) -> str:
        del workspace_id, account_id
        return "editor"


@dataclass
class Exporter:
    engine: Engine
    calls: list[tuple[str, str]] = field(default_factory=list)
    failure: bool = False

    def export(self, workspace_id: str, pipeline_id: str) -> str:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        self.calls.append((workspace_id, pipeline_id))
        if self.failure:
            raise RuntimeError("export unavailable")
        return "workflow:\n  graph:\n    nodes: []\n    edges: []\n"


@pytest.fixture
def exporter(sqlite_engine: Engine) -> Exporter:
    return Exporter(sqlite_engine)


@pytest.fixture
def service(sqlite_session_factory: sessionmaker[Session], exporter: Exporter) -> PipelineTemplateService:
    return PipelineTemplateService(
        catalog=PipelineTemplateCatalogAdapter(sqlite_session_factory, built_in_mode="database"),
        store=PipelineTemplateRepository(sqlite_session_factory),
        exporter=exporter,
        dataset_access=DatasetAccessService(
            datasets=SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory),
            workspace_roles=EditorRole(),
            legacy_permissions_enabled=True,
        ),
    )


@pytest.fixture(autouse=True)
def source(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        account = Account(name="Template author", email="template@example.test")
        account.id = CONTEXT.account_id
        pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", workflow_id="published")
        pipeline.id = "pipeline-1"
        session.add_all(
            [
                account,
                pipeline,
                Dataset(
                    id="dataset-1",
                    tenant_id="tenant-1",
                    name="Dataset",
                    pipeline_id="pipeline-1",
                    created_by="account-1",
                    permission="all_team_members",
                    chunk_structure="paragraph",
                ),
                _workflow("published", version="published"),
                _workflow("draft", version="draft"),
            ]
        )


def _workflow(workflow_id: str, *, version: str) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="pipeline-1",
        type="rag-pipeline",
        version=version,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def test_template_lifecycle_preserves_export_and_releases_connections(
    service: PipelineTemplateService,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    exporter: Exporter,
) -> None:
    service.publish(CONTEXT, "pipeline-1", TEMPLATE, can_edit_datasets=True)
    result = service.list_templates(CONTEXT, "customized", "en-US")
    item = result["pipeline_templates"][0]
    template_id = item["id"]
    assert {key: value for key, value in item.items() if key != "id"} == {
        "name": "Template",
        "description": "Description",
        "icon": {"icon": "book"},
        "position": 1,
        "chunk_structure": "paragraph",
    }
    detail = service.get_template(CONTEXT, template_id, "customized")
    assert detail is not None
    assert detail["created_by"] == "Template author"
    assert detail["graph"] == {"nodes": [], "edges": []}
    original_yaml = service.get_yaml(CONTEXT, template_id)
    assert detail["export_data"] == original_yaml
    assert service.list_templates(CONTEXT, "customized", "ja-JP") == {"pipeline_templates": []}
    foreign = CONTEXT._replace(active_workspace_id="tenant-2")
    assert service.list_templates(foreign, "customized", "en-US") == {"pipeline_templates": []}
    assert service.get_template(foreign, template_id, "customized") is None
    for operation in (
        lambda: service.get_yaml(foreign, template_id),
        lambda: service.update(foreign, template_id, TEMPLATE),
        lambda: service.delete(foreign, template_id),
    ):
        with pytest.raises(PipelineTemplateNotFoundError):
            operation()
    service.update(CONTEXT, template_id, PipelineTemplateInput("Updated", "New description", {}))
    assert service.get_yaml(CONTEXT, template_id) == original_yaml
    with sqlite_session_factory() as session:
        template = session.get(PipelineCustomizedTemplate, template_id)
        assert template is not None
        assert (template.name, template.updated_by, template.created_by) == ("Updated", "account-1", "account-1")
    service.delete(CONTEXT, template_id)
    assert service.get_template(CONTEXT, template_id, "customized") is None
    assert exporter.calls == [("tenant-1", "pipeline-1")]
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0


def test_conflicts_preserve_rows_and_positions(
    service: PipelineTemplateService,
    exporter: Exporter,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service.publish(CONTEXT, "pipeline-1", TEMPLATE, can_edit_datasets=True)
    with pytest.raises(PipelineTemplateNameConflictError):
        service.publish(CONTEXT, "pipeline-1", TEMPLATE, can_edit_datasets=True)
    assert len(exporter.calls) == 1
    second = PipelineTemplateInput("Second", "Other", {})
    service.publish(CONTEXT, "pipeline-1", second, can_edit_datasets=True)
    items = service.list_templates(CONTEXT, "customized", "en-US")["pipeline_templates"]
    assert [(item["name"], item["position"]) for item in items] == [("Template", 1), ("Second", 2)]
    with pytest.raises(PipelineTemplateNameConflictError):
        service.update(CONTEXT, items[1]["id"], TEMPLATE)
    detail = service.get_template(CONTEXT, items[1]["id"], "customized")
    assert detail is not None
    assert detail["name"] == "Second"
    # A write rechecks conflicts after export; another request may have created the name.
    store = PipelineTemplateRepository(sqlite_session_factory)
    with pytest.raises(PipelineTemplateNameConflictError):
        store.create("tenant-1", "account-1", TEMPLATE, yaml_content="", chunk_structure="paragraph")
    service.update(CONTEXT, items[0]["id"], TEMPLATE)
    service.update(CONTEXT, items[0]["id"], PipelineTemplateInput("", "Empty legacy name", {}))
    detail = service.get_template(CONTEXT, items[0]["id"], "customized")
    assert detail is not None
    assert detail["description"] == "Empty legacy name"


@pytest.mark.parametrize(
    ("target", "attribute", "value", "message"),
    [
        ("pipeline", "workflow_id", None, "Pipeline workflow not found"),
        ("published", "tenant_id", "foreign", "Workflow not found"),
        ("published", "app_id", "foreign", "Workflow not found"),
        ("draft", "tenant_id", "foreign", "Draft workflow not found"),
        ("draft", "app_id", "foreign", "Draft workflow not found"),
        ("draft", "version", "old", "Draft workflow not found"),
        ("dataset", "tenant_id", "foreign", "Dataset not found"),
        ("dataset", "pipeline_id", "foreign", "Dataset not found"),
        ("pipeline", "tenant_id", "foreign", "Pipeline not found"),
    ],
)
def test_publication_rejects_missing_or_foreign_resources_before_export(
    service: PipelineTemplateService,
    exporter: Exporter,
    sqlite_session_factory: sessionmaker[Session],
    target: str,
    attribute: str,
    value: str | None,
    message: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        if target == "pipeline":
            model = session.get(Pipeline, "pipeline-1")
        elif target == "dataset":
            model = session.get(Dataset, "dataset-1")
        else:
            model = session.get(Workflow, target)
        assert model is not None
        setattr(model, attribute, value)
    with pytest.raises(PipelineTemplateNotFoundError, match=message):
        service.publish(CONTEXT, "pipeline-1", TEMPLATE, can_edit_datasets=True)
    assert exporter.calls == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(PipelineCustomizedTemplate.id)) is None


def test_publication_rejects_legacy_role_and_dataset_acl_before_export(
    service: PipelineTemplateService,
    exporter: Exporter,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with pytest.raises(PipelineTemplatePublishForbiddenError):
        service.publish(CONTEXT, "pipeline-1", TEMPLATE, can_edit_datasets=False)
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.permission = DatasetPermissionEnum.ONLY_ME
        dataset.created_by = "other-account"
    with pytest.raises(DatasetAccessDeniedError):
        service.publish(CONTEXT, "pipeline-1", TEMPLATE, can_edit_datasets=True)
    assert exporter.calls == []


def test_export_failure_leaves_no_template(
    service: PipelineTemplateService,
    exporter: Exporter,
) -> None:
    exporter.failure = True
    with pytest.raises(RuntimeError, match="export unavailable"):
        service.publish(CONTEXT, "pipeline-1", TEMPLATE, can_edit_datasets=True)
    assert service.list_templates(CONTEXT, "customized", "en-US") == {"pipeline_templates": []}


def test_real_dsl_exporter_uses_owned_draft_and_releases_session(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    mocker: MockerFixture,
) -> None:
    plugins = mocker.patch(
        "services.plugin.dependencies_analysis.PluginInstaller.fetch_plugin_installation_by_ids", return_value=[]
    )
    exporter = PipelineTemplateDslExporter(sqlite_session_factory)
    data = yaml.safe_load(exporter.export("tenant-1", "pipeline-1"))
    assert data["kind"] == "rag_pipeline"
    assert data["rag_pipeline"]["name"] == "Dataset"
    assert data["workflow"]["graph"] == {"nodes": [], "edges": []}
    plugins.assert_called_once_with("tenant-1", [])
    with pytest.raises(PipelineTemplateNotFoundError):
        exporter.export("tenant-2", "pipeline-1")
    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0
