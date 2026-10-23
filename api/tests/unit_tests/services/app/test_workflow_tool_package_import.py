"""App packages carry the workflows their Workflow Tools run into another workspace."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from uuid import uuid4
from zipfile import ZipFile

import pytest
import yaml
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin import PluginDependency
from core.tools.entities.tool_entities import ToolProviderType
from extensions.application_services.app import AppServices
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode
from models.tools import ToolLabelBinding, WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import AppImportParams, Import, ImportStatus
from services.entities.feature_entities import FeatureModel, LimitationModel
from services.errors.base import NoPermissionError
from services.feature_service import FeatureService
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task
from tests.unit_tests.model_factories import make_account, make_tenant

_TOOL_NAME = "summarize"


@dataclass(frozen=True)
class Workspaces:
    source: RequestContext
    target: RequestContext
    caller_app_id: str
    tool_app_id: str
    provider_id: str


def _no_plugin_dependencies(*, tenant_id: str, dependencies: list[str]) -> list[PluginDependency]:
    del tenant_id
    assert dependencies == []
    return []


def _features_with_one_free_app(tenant_id: str, *, exclude_vector_space: bool) -> FeatureModel:
    del tenant_id, exclude_vector_space
    return FeatureModel(apps=LimitationModel(size=4, limit=5))


def _workflow(*, tenant_id: str, app_id: str, version: str, graph: dict[str, object], created_by: str) -> Workflow:
    return Workflow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW.value,
        version=version,
        graph=json.dumps(graph),
        features=json.dumps({}),
        environment_variables=[],
        conversation_variables=[],
        created_by=created_by,
    )


def _workflow_tool(
    *, provider_id: str, tenant_id: str, app_id: str, version: str, user_id: str
) -> WorkflowToolProvider:
    provider = WorkflowToolProvider(
        name=_TOOL_NAME,
        label="Summarize",
        icon=json.dumps({"background": "#FFEAD5", "content": "🤖"}),
        app_id=app_id,
        version=version,
        user_id=user_id,
        tenant_id=tenant_id,
        description="Summarize a document",
        parameter_configuration="[]",
    )
    provider.id = provider_id
    return provider


def _tool_node(provider_id: str, tool_name: str) -> dict[str, object]:
    return {
        "id": tool_name,
        "data": {
            "type": "tool",
            "title": tool_name,
            "provider_id": provider_id,
            "provider_type": "workflow",
            "provider_name": tool_name,
            "tool_name": tool_name,
            "tool_label": tool_name,
            "tool_configurations": dict[str, object](),
            "tool_parameters": dict[str, object](),
        },
    }


@pytest.fixture
def workspaces(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> Workspaces:
    config_overrides(RBAC_ENABLED=False, DEPLOYMENT_EDITION="COMMUNITY")
    # Workflow Tool management opens its own sessions from the Flask-SQLAlchemy engine.
    monkeypatch.setattr(type(db), "engine", property(lambda _: sqlite_engine))
    # Plugin metadata is resolved by the plugin daemon; these Apps use no plugins.
    monkeypatch.setattr(DependenciesAnalysisService, "generate_dependencies", _no_plugin_dependencies)
    actor, source_id, target_id = str(uuid4()), str(uuid4()), str(uuid4())
    caller_app_id, tool_app_id, provider_id = str(uuid4()), str(uuid4()), str(uuid4())
    version = Workflow.version_from_datetime(naive_utc_now())
    published = _workflow(
        tenant_id=source_id,
        app_id=tool_app_id,
        version=version,
        graph={"nodes": list[object](), "edges": list[object]()},
        created_by=actor,
    )
    caller_graph: dict[str, object] = {"nodes": [_tool_node(provider_id, _TOOL_NAME)], "edges": list[object]()}
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_account(account_id=actor, name="Creator", email=f"{actor}@example.com"),
                make_tenant(tenant_id=source_id, name="Source"),
                make_tenant(tenant_id=target_id, name="Target"),
                TenantAccountJoin(tenant_id=source_id, account_id=actor, role=TenantAccountRole.OWNER),
                TenantAccountJoin(tenant_id=target_id, account_id=actor, role=TenantAccountRole.OWNER),
                App(
                    id=tool_app_id,
                    tenant_id=source_id,
                    name="Summarizer",
                    mode=AppMode.WORKFLOW,
                    enable_site=True,
                    enable_api=True,
                    workflow_id=published.id,
                ),
                published,
                _workflow_tool(
                    provider_id=provider_id, tenant_id=source_id, app_id=tool_app_id, version=version, user_id=actor
                ),
                ToolLabelBinding(tool_id=provider_id, tool_type=ToolProviderType.WORKFLOW, label_name="productivity"),
                App(
                    id=caller_app_id,
                    tenant_id=source_id,
                    name="Caller",
                    mode=AppMode.WORKFLOW,
                    enable_site=True,
                    enable_api=True,
                ),
                _workflow(
                    tenant_id=source_id,
                    app_id=caller_app_id,
                    version=Workflow.VERSION_DRAFT,
                    graph=caller_graph,
                    created_by=actor,
                ),
            ]
        )
    return Workspaces(
        source=RequestContext("request", None, actor, source_id),
        target=RequestContext("request", None, actor, target_id),
        caller_app_id=caller_app_id,
        tool_app_id=tool_app_id,
        provider_id=provider_id,
    )


def _export_and_import(
    app_services: AppServices, workspaces: Workspaces, context: RequestContext, params: AppImportParams
) -> Import:
    exported = app_services.console.export(workspaces.source, workspaces.caller_app_id, AppExportOptions())
    assert not isinstance(exported, str)
    with exported:
        return app_services.console.import_app(context, params, source=exported.archive)


def _caller_tool_node(session: Session, app_id: str) -> dict[str, object]:
    draft = session.scalar(
        select(Workflow).where(Workflow.app_id == app_id, Workflow.version == Workflow.VERSION_DRAFT)
    )
    assert draft is not None
    [node] = draft.graph_dict["nodes"]
    return node["data"]


def test_export_bundles_the_pinned_workflow_and_its_tool_definition(
    app_services: AppServices, workspaces: Workspaces
) -> None:
    exported = app_services.console.export(workspaces.source, workspaces.caller_app_id, AppExportOptions())
    assert not isinstance(exported, str)
    with exported, ZipFile(exported.archive) as archive:
        manifest = yaml.safe_load(archive.read("manifest.yaml"))
        assert manifest["format_version"] == 2
        [tool] = manifest["workflow_tools"]
        assert (tool["provider_id"], tool["name"], tool["labels"]) == (
            workspaces.provider_id,
            _TOOL_NAME,
            ["productivity"],
        )
        with ZipFile(archive.open(tool["path"])) as nested:
            assert yaml.safe_load(nested.read("app.yaml"))["app"]["name"] == "Summarizer"


def test_import_into_another_workspace_recreates_the_called_workflow_as_a_tool(
    app_services: AppServices, workspaces: Workspaces, sqlite_session_factory: sessionmaker[Session]
) -> None:
    result = _export_and_import(app_services, workspaces, workspaces.target, AppImportParams(mode="yaml-content"))

    assert result.status == ImportStatus.COMPLETED
    target_id = workspaces.target.active_workspace_id
    with sqlite_session_factory() as session:
        [provider] = session.scalars(select(WorkflowToolProvider).where(WorkflowToolProvider.tenant_id == target_id))
        assert provider.id != workspaces.provider_id
        assert provider.name == _TOOL_NAME
        tool_app = session.get(App, provider.app_id)
        assert tool_app is not None
        assert (tool_app.tenant_id, tool_app.name) == (target_id, "Summarizer")
        published = session.get(Workflow, tool_app.workflow_id)
        assert published is not None
        assert published.version == provider.version
        assert list(session.scalars(select(ToolLabelBinding.label_name).where(ToolLabelBinding.tool_id == provider.id)))
        assert _caller_tool_node(session, str(result.app_id))["provider_id"] == provider.id
        assert {app.id for app in session.scalars(select(App).where(App.tenant_id == target_id))} == {
            tool_app.id,
            result.app_id,
        }


def test_import_into_the_same_workspace_reuses_the_existing_tool(
    app_services: AppServices, workspaces: Workspaces, sqlite_session_factory: sessionmaker[Session]
) -> None:
    result = _export_and_import(app_services, workspaces, workspaces.source, AppImportParams(mode="yaml-content"))

    assert result.status == ImportStatus.COMPLETED
    source_id = workspaces.source.active_workspace_id
    with sqlite_session_factory() as session:
        providers = session.scalars(select(WorkflowToolProvider.id).where(WorkflowToolProvider.tenant_id == source_id))
        assert list(providers) == [workspaces.provider_id]
        assert session.scalar(select(App.id).where(App.id == result.app_id)) is not None
        assert len(list(session.scalars(select(App.id).where(App.tenant_id == source_id)))) == 3
        assert _caller_tool_node(session, str(result.app_id))["provider_id"] == workspaces.provider_id


def test_import_renames_a_tool_whose_name_is_taken(
    app_services: AppServices, workspaces: Workspaces, sqlite_session_factory: sessionmaker[Session]
) -> None:
    target_id = workspaces.target.active_workspace_id
    taken_app_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                App(
                    id=taken_app_id,
                    tenant_id=target_id,
                    name="Taken",
                    mode=AppMode.WORKFLOW,
                    enable_site=True,
                    enable_api=True,
                ),
                _workflow_tool(
                    provider_id=str(uuid4()),
                    tenant_id=target_id,
                    app_id=taken_app_id,
                    version="1",
                    user_id=workspaces.target.account_id,
                ),
            ]
        )

    result = _export_and_import(app_services, workspaces, workspaces.target, AppImportParams(mode="yaml-content"))

    assert result.status == ImportStatus.COMPLETED
    with sqlite_session_factory() as session:
        provider = session.scalar(
            select(WorkflowToolProvider).where(
                WorkflowToolProvider.tenant_id == target_id, WorkflowToolProvider.app_id != taken_app_id
            )
        )
        assert provider is not None
        assert provider.name == f"{_TOOL_NAME}_2"
        node = _caller_tool_node(session, str(result.app_id))
        assert (node["provider_id"], node["tool_name"]) == (provider.id, f"{_TOOL_NAME}_2")


def test_import_requires_permission_to_create_tools_before_creating_anything(
    app_services: AppServices, workspaces: Workspaces, sqlite_session_factory: sessionmaker[Session]
) -> None:
    target_id = workspaces.target.active_workspace_id
    with sqlite_session_factory.begin() as session:
        join = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == target_id))
        assert join is not None
        join.role = TenantAccountRole.EDITOR

    with pytest.raises(NoPermissionError, match="workflow tools"):
        _export_and_import(app_services, workspaces, workspaces.target, AppImportParams(mode="yaml-content"))

    with sqlite_session_factory() as session:
        assert list(session.scalars(select(App.id).where(App.tenant_id == target_id))) == []


def test_failed_import_deletes_the_workflows_it_created(
    app_services: AppServices,
    workspaces: Workspaces,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cleanups: list[dict[str, str]] = []
    monkeypatch.setattr(remove_app_and_related_data_task, "delay", lambda **kwargs: cleanups.append(kwargs))
    target_id = workspaces.target.active_workspace_id

    result = _export_and_import(
        app_services, workspaces, workspaces.target, AppImportParams(mode="yaml-content", app_id=str(uuid4()))
    )

    assert result.status == ImportStatus.FAILED
    [cleanup] = cleanups
    assert cleanup["tenant_id"] == target_id
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(App.id).where(App.tenant_id == target_id))) == []


def test_import_recreates_workflows_that_call_each_other(
    app_services: AppServices, workspaces: Workspaces, sqlite_session_factory: sessionmaker[Session]
) -> None:
    source_id, actor = workspaces.source.active_workspace_id, workspaces.source.account_id
    ranker_app_id, ranker_provider_id = str(uuid4()), str(uuid4())
    version = Workflow.version_from_datetime(naive_utc_now())
    ranker_workflow = _workflow(
        tenant_id=source_id,
        app_id=ranker_app_id,
        version=version,
        graph={"nodes": [_tool_node(workspaces.provider_id, _TOOL_NAME)], "edges": list[object]()},
        created_by=actor,
    )
    ranker = _workflow_tool(
        provider_id=ranker_provider_id, tenant_id=source_id, app_id=ranker_app_id, version=version, user_id=actor
    )
    ranker.name = "rank"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                App(
                    id=ranker_app_id,
                    tenant_id=source_id,
                    name="Ranker",
                    mode=AppMode.WORKFLOW,
                    enable_site=True,
                    enable_api=True,
                    workflow_id=ranker_workflow.id,
                ),
                ranker_workflow,
                ranker,
            ]
        )
        summarizer = session.scalar(
            select(Workflow).where(
                Workflow.app_id == workspaces.tool_app_id, Workflow.version != Workflow.VERSION_DRAFT
            )
        )
        assert summarizer is not None
        summarizer.graph = json.dumps({"nodes": [_tool_node(ranker_provider_id, "rank")], "edges": list[object]()})

    result = _export_and_import(app_services, workspaces, workspaces.target, AppImportParams(mode="yaml-content"))

    assert result.status == ImportStatus.COMPLETED
    target_id = workspaces.target.active_workspace_id
    with sqlite_session_factory() as session:
        providers = {
            provider.name: provider
            for provider in session.scalars(
                select(WorkflowToolProvider).where(WorkflowToolProvider.tenant_id == target_id)
            )
        }
        assert set(providers) == {_TOOL_NAME, "rank"}
        for name, called in ((_TOOL_NAME, "rank"), ("rank", _TOOL_NAME)):
            published = session.scalar(
                select(Workflow).where(
                    Workflow.app_id == providers[name].app_id, Workflow.version == providers[name].version
                )
            )
            assert published is not None
            [node] = published.graph_dict["nodes"]
            assert node["data"]["provider_id"] == providers[called].id


def test_import_checks_the_quota_for_every_app_it_creates(
    app_services: AppServices,
    workspaces: Workspaces,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    exported = app_services.console.export(workspaces.source, workspaces.caller_app_id, AppExportOptions())
    assert not isinstance(exported, str)
    config_overrides(DEPLOYMENT_EDITION="CLOUD")
    # Billing limits come from the billing service; one App slot is left for a package that needs two.
    monkeypatch.setattr(FeatureService, "get_features", _features_with_one_free_app)

    with exported, pytest.raises(NoPermissionError, match="limit"):
        app_services.console.import_app(
            workspaces.target, AppImportParams(mode="yaml-content"), source=exported.archive
        )

    target_id = workspaces.target.active_workspace_id
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(App.id).where(App.tenant_id == target_id))) == []
