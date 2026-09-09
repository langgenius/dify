import copy
import io
import json
import zipfile
from typing import cast
from unittest.mock import Mock
from uuid import uuid4

import pytest
import yaml
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.rbac import RBACPermission, RBACResourceScope
from core.tools.entities.tool_entities import ToolProviderType, WorkflowToolParameterConfiguration
from models import Account, App, AppMode, Tenant
from models.account import TenantAccountRole
from models.agent import Agent, AgentConfigDraft, AgentConfigSnapshot
from models.model import AppModelConfig
from models.tools import ToolLabelBinding, WorkflowToolProvider
from models.workflow import Workflow, WorkflowContentDict
from services.app_dsl_bundle import AppDslBundle, AppDslBundleService, _tool_references
from services.app_dsl_service import AppDslService
from services.errors.account import NoPermissionError
from services.workflow_service import WorkflowService
from tests.unit_tests.config_override import apply_config_overrides


def _account() -> Account:
    tenant = Tenant(name="Bundle workspace")
    tenant.id = str(uuid4())
    account = Account(name="Bundle author", email=f"{uuid4()}@example.com")
    account.id = str(uuid4())
    account._current_tenant = tenant
    account.role = TenantAccountRole.OWNER
    return account


def _document(name: str, tools: dict[str, str]) -> dict[str, object]:
    nodes: list[dict[str, object]] = [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}]
    for provider_id, tool_name in tools.items():
        nodes.append(
            {
                "id": provider_id,
                "data": {
                    "type": "tool",
                    "title": tool_name,
                    "provider_type": "workflow",
                    "provider_id": provider_id,
                    "provider_name": provider_id,
                    "tool_name": tool_name,
                    "tool_label": tool_name,
                    "tool_parameters": {},
                    "tool_configurations": {},
                },
            }
        )
    nodes.append({"id": "end", "data": {"type": "end", "title": "End", "outputs": []}})
    return {
        "kind": "app",
        "version": CURRENT_APP_DSL_VERSION,
        "app": {"name": name, "mode": "workflow"},
        "workflow": {"graph": {"nodes": nodes, "edges": []}, "features": {}},
    }


def _app_document(mode: AppMode, tools: dict[str, str]) -> dict[str, object]:
    document = _document(f"Root {mode}", tools)
    cast(dict[str, object], document["app"])["mode"] = mode
    if mode == AppMode.ADVANCED_CHAT:
        workflow = cast(WorkflowContentDict, document["workflow"])
        workflow["graph"]["nodes"][-1]["data"] = {"type": "answer", "answer": "done"}
    elif mode in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION}:
        del document["workflow"]
        model_config: dict[str, object] = {
            "model": {},
            "pre_prompt": "Use the configured tools.",
            "agent_mode": {
                "enabled": True,
                "strategy": "function_call",
                "tools": [
                    {
                        "enabled": True,
                        "provider_type": "workflow",
                        "provider_id": provider_id,
                        "tool_name": name,
                        "tool_parameters": {},
                    }
                    for provider_id, name in tools.items()
                ],
            },
        }
        document["model_config"] = model_config
    elif mode == AppMode.AGENT:
        del document["workflow"]
        document["agent"] = {"package_ref": "agent_1"}
        document["agent_packages"] = {
            "agent_1": {
                "schema_version": 1,
                "metadata": {"name": "Bundled Agent"},
                "soul": {
                    "prompt": {
                        "system_prompt": " ".join(
                            f"Call [§tool:{provider_id}/{name}:Workflow§]" for provider_id, name in tools.items()
                        )
                    },
                    "tools": {
                        "dify_tools": [
                            {
                                "enabled": True,
                                "provider_type": "workflow",
                                "provider_id": provider_id,
                                "tool_name": name,
                                "name": name,
                            }
                            for provider_id, name in tools.items()
                        ]
                    },
                },
            }
        }
    return document


def _seed_bundle(session: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[Account, App, bytes]:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False, DEPLOYMENT_EDITION="SELF_HOSTED")
    monkeypatch.setattr("services.app_dsl_service.app_was_created", Mock())
    monkeypatch.setattr(
        "services.app_dsl_service.DependenciesAnalysisService.generate_dependencies", Mock(return_value=[])
    )
    monkeypatch.setattr("services.app_dsl_bundle.app_published_workflow_was_updated", Mock())
    monkeypatch.setattr("services.workflow_service.SystemFeatureService.is_plugin_manager_enabled", lambda: False)
    monkeypatch.setattr(WorkflowService, "__init__", lambda _self: None)
    account = _account()
    service = AppDslService(session)
    b_id, c_id = str(uuid4()), str(uuid4())
    apps = [
        service._create_or_update_app(app=None, data=document, account=account, commit=False)
        for document in (
            _document("Root", {b_id: "nested", c_id: "shared"}),
            _document("Nested", {c_id: "shared"}),
            _document("Shared", {b_id: "nested"}),
        )
    ]
    for app, provider_id, name in zip(apps[1:], (b_id, c_id), ("nested", "shared"), strict=True):
        published = WorkflowService().publish_workflow(
            session=session, app_model=app, account=account, marked_name="Tool release", emit_event=False
        )
        app.workflow_id = published.id
        provider = WorkflowToolProvider(
            tenant_id=app.tenant_id,
            user_id=account.id,
            app_id=app.id,
            version=published.version,
            name=name,
            label=f"{name} label",
            icon=json.dumps({"content": "🔧", "background": "#FFFFFF"}),
            description=f"{name} description",
            privacy_policy="https://example.com/privacy",
        )
        provider.id = provider_id
        session.add(provider)
    session.add(ToolLabelBinding(tool_id=b_id, tool_type=ToolProviderType.WORKFLOW, label_name="search"))
    session.commit()
    # Published tool versions must be exported even when their drafts have since changed.
    draft = WorkflowService().get_draft_workflow(apps[1], session=session)
    assert draft is not None
    draft.graph = json.dumps(cast(WorkflowContentDict, _document("Changed draft", {})["workflow"])["graph"])
    session.commit()
    content = AppDslBundleService(session).export_bundle(apps[0], account=account)
    assert content is not None
    return account, apps[0], content


def _archive(
    bundle: AppDslBundle, extra: tuple[str, str] | None = None, *, manifest: dict[str, object] | None = None
) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.yaml",
            yaml.safe_dump(manifest if manifest is not None else bundle.manifest.model_dump(mode="json")),
        )
        for marker, document in bundle.documents.items():
            archive.writestr(bundle.manifest.apps[marker].file, yaml.safe_dump(document))
        if extra:
            archive.writestr(*extra)
    return output.getvalue()


def test_nested_shared_cyclic_tools_round_trip_with_independent_files(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_account, source, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle_service = AppDslBundleService(sqlite_session)
    bundle = bundle_service.parse_bundle(content)
    assert len(bundle.documents) == 3
    assert all(document["version"] == CURRENT_APP_DSL_VERSION for document in bundle.documents.values())
    assert len(bundle.manifest.tools) == 2
    assert sorted(
        sum(relation.source == marker for relation in bundle.manifest.relationships) for marker in bundle.documents
    ) == [1, 1, 2]
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert len(archive.namelist()) == 4
    destination = _account()
    signal = Mock()
    monkeypatch.setattr("services.app_dsl_bundle.app_published_workflow_was_updated", signal)
    imported = bundle_service.import_bundle(bundle, account=destination, dsl_service=AppDslService(sqlite_session))
    signal.send.assert_not_called()
    sqlite_session.commit()
    assert signal.send.call_count == 2
    providers = list(
        sqlite_session.scalars(
            select(WorkflowToolProvider).where(WorkflowToolProvider.tenant_id == destination.current_tenant_id)
        )
    )
    assert {provider.name for provider in providers} == {"nested", "shared"}
    assert all(provider.privacy_policy == "https://example.com/privacy" for provider in providers)
    assert imported.id != source.id
    assert imported.tenant_id != source_account.current_tenant_id
    second_export = bundle_service.export_bundle(imported, account=destination)
    assert second_export is not None
    restored = bundle_service.parse_bundle(second_export)
    assert restored.manifest == bundle.manifest
    assert restored.documents == bundle.documents


APP_MODES = [
    AppMode.WORKFLOW,
    AppMode.ADVANCED_CHAT,
    AppMode.CHAT,
    AppMode.AGENT_CHAT,
    AppMode.COMPLETION,
    AppMode.AGENT,
]


@pytest.mark.parametrize("mode", APP_MODES)
def test_app_without_workflow_tools_round_trips_in_a_bundle(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, mode: AppMode
) -> None:
    account, _, _ = _seed_bundle(sqlite_session, monkeypatch)
    source = AppDslService(sqlite_session)._create_or_update_app(
        app=None, data=_app_document(mode, {}), account=account, commit=False
    )
    sqlite_session.commit()
    service = AppDslBundleService(sqlite_session)
    content = service.export_bundle(source, account=account)
    assert content is not None
    bundle = service.parse_bundle(content)
    assert bundle.manifest.kind == "app_bundle"
    assert list(bundle.manifest.resources) == [bundle.manifest.entrypoint]
    assert bundle.manifest.relationships == []
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert set(archive.namelist()) == {"manifest.yaml", "apps/app_1.yaml"}
    destination = _account()
    imported = service.import_bundle(bundle, account=destination, dsl_service=AppDslService(sqlite_session))
    sqlite_session.commit()
    assert imported.mode == mode
    assert imported.id != source.id
    restored = service.parse_bundle(service.export_bundle(imported, account=destination))
    assert restored.documents == bundle.documents
    assert restored.manifest == bundle.manifest
    if mode == AppMode.AGENT:
        assert not imported.enable_api
        assert not imported.enable_site
        agent = imported.agent_app_binding_with_session(session=sqlite_session)
        assert agent is not None
        assert not agent.active_config_is_published


@pytest.mark.parametrize("mode", APP_MODES)
def test_each_app_mode_remaps_nested_workflow_tools_and_name_collisions(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, mode: AppMode
) -> None:
    account, _, _ = _seed_bundle(sqlite_session, monkeypatch)
    source_provider = sqlite_session.scalar(select(WorkflowToolProvider).where(WorkflowToolProvider.name == "nested"))
    assert source_provider is not None
    source = AppDslService(sqlite_session)._create_or_update_app(
        app=None,
        data=_app_document(mode, {source_provider.id: source_provider.name}),
        account=account,
        commit=False,
    )
    sqlite_session.commit()
    service = AppDslBundleService(sqlite_session)
    bundle = service.parse_bundle(service.export_bundle(source, account=account))
    assert len(bundle.documents) == 3
    assert len(bundle.manifest.tools) == 2
    assert {resource.kind for resource in bundle.manifest.resources.values()} == {"app", "workflow_tool"}
    imported = service.import_bundle(bundle, account=account, dsl_service=AppDslService(sqlite_session))
    sqlite_session.commit()
    imported_document = yaml.safe_load(AppDslService.export_dsl(imported, session=sqlite_session))
    references = list(_tool_references(imported_document))
    assert len(references) == 1
    reference = references[0]
    assert reference["provider_id"] != source_provider.id
    assert reference["tool_name"] == "nested_2"
    provider = sqlite_session.get(WorkflowToolProvider, reference["provider_id"])
    assert provider is not None
    assert provider.name == reference["tool_name"]
    assert provider.tenant_id == account.current_tenant_id
    nested = sqlite_session.get(App, provider.app_id)
    assert nested is not None
    published = sqlite_session.get(Workflow, nested.workflow_id)
    assert published is not None
    assert published.version == provider.version
    nested_reference = next(node["data"] for node in published.graph_dict["nodes"] if node["data"]["type"] == "tool")
    assert nested_reference["tool_name"] == "shared_2"
    assert sqlite_session.get(WorkflowToolProvider, nested_reference["provider_id"]) is not None
    if mode == AppMode.AGENT:
        assert reference["name"] == "nested_2"
        prompt = imported_document["agent_packages"]["agent_1"]["soul"]["prompt"]["system_prompt"]
        assert prompt == f"Call [§tool:{provider.id}/nested_2:Workflow§]"
        assert not imported.enable_api
        assert not imported.enable_site
    restored = service.parse_bundle(service.export_bundle(imported, account=account))
    assert {tool.name for tool in restored.manifest.tools.values()} == {"nested_2", "shared_2"}


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION, AppMode.AGENT])
def test_invalid_nested_deployment_rolls_back_non_workflow_app_state(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, mode: AppMode
) -> None:
    account, _, _ = _seed_bundle(sqlite_session, monkeypatch)
    source_provider = sqlite_session.scalar(select(WorkflowToolProvider).where(WorkflowToolProvider.name == "nested"))
    assert source_provider is not None
    source = AppDslService(sqlite_session)._create_or_update_app(
        app=None,
        data=_app_document(mode, {source_provider.id: source_provider.name}),
        account=account,
        commit=False,
    )
    sqlite_session.commit()
    service = AppDslBundleService(sqlite_session)
    bundle = service.parse_bundle(service.export_bundle(source, account=account))
    bundle.manifest.tools["tool_2"].parameters = [
        WorkflowToolParameterConfiguration(name="missing_input", description="", form="llm")
    ]
    models = [App, Workflow, WorkflowToolProvider, AppModelConfig, Agent, AgentConfigSnapshot, AgentConfigDraft]
    before = [sqlite_session.scalar(select(func.count()).select_from(model)) for model in models]
    signal = Mock()
    monkeypatch.setattr("services.app_dsl_bundle.app_published_workflow_was_updated", signal)
    with pytest.raises(ValueError, match="variable not found"):
        service.import_bundle(bundle, account=_account(), dsl_service=AppDslService(sqlite_session))
    sqlite_session.rollback()
    assert [sqlite_session.scalar(select(func.count()).select_from(model)) for model in models] == before
    sqlite_session.commit()
    signal.send.assert_not_called()


def test_late_invalid_tool_deployment_rolls_back_all_workflows(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    service = AppDslBundleService(sqlite_session)
    bundle = service.parse_bundle(content)
    invalid = bundle.manifest.tools["tool_2"]
    invalid.parameters = [WorkflowToolParameterConfiguration(name="missing_input", description="", form="llm")]
    before = sqlite_session.scalar(select(func.count()).select_from(App))
    with pytest.raises(ValueError, match="variable not found"):
        service.import_bundle(bundle, account=_account(), dsl_service=AppDslService(sqlite_session))
    sqlite_session.rollback()
    assert sqlite_session.scalar(select(func.count()).select_from(App)) == before
    sqlite_session.commit()


def test_existing_tool_names_are_remapped_without_reusing_source_providers(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account, _, content = _seed_bundle(sqlite_session, monkeypatch)
    service = AppDslBundleService(sqlite_session)
    imported = service.import_bundle(
        service.parse_bundle(content), account=account, dsl_service=AppDslService(sqlite_session)
    )
    sqlite_session.commit()
    output = service.export_bundle(imported, account=account)
    assert output is not None
    restored = service.parse_bundle(output)
    assert {tool.name for tool in restored.manifest.tools.values()} == {"nested_2", "shared_2"}
    assert sqlite_session.scalar(select(func.count()).select_from(WorkflowToolProvider)) == 4


def test_rollback_discards_deployment_callbacks(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    service = AppDslBundleService(sqlite_session)
    signal = Mock()
    monkeypatch.setattr("services.app_dsl_bundle.app_published_workflow_was_updated", signal)
    service.import_bundle(service.parse_bundle(content), account=_account(), dsl_service=AppDslService(sqlite_session))
    sqlite_session.rollback()
    sqlite_session.commit()
    signal.send.assert_not_called()


def test_bundle_quota_counts_every_new_app(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    service = AppDslBundleService(sqlite_session)
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION="CLOUD")
    features = Mock()
    features.apps.size = 8
    features.apps.limit = 10
    monkeypatch.setattr("services.app_dsl_bundle.FeatureService.get_features", Mock(return_value=features))
    with pytest.raises(ValueError, match="subscription limit"):
        service.import_bundle(
            service.parse_bundle(content), account=_account(), dsl_service=AppDslService(sqlite_session)
        )
    assert not sqlite_session.new


def test_overwrite_activation_change_requires_release_permission(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account, app, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle = AppDslBundleService.parse_bundle(content)
    bundle.manifest.apps[bundle.manifest.entrypoint].enable_api = not app.enable_api
    caller = copy.copy(account)
    caller.id = str(uuid4())
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr("services.app_dsl_bundle.RBACService.CheckAccess.check", Mock(side_effect=[True, True, False]))
    with pytest.raises(NoPermissionError, match="release permission"):
        AppDslBundleService(sqlite_session).import_bundle(
            bundle, account=caller, app=app, dsl_service=AppDslService(sqlite_session)
        )


@pytest.mark.parametrize("corruption", ["marker", "relationship", "traversal", "unknown_file", "app_mode", "alias"])
def test_rejects_invalid_archive_before_import(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, corruption: str
) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle = AppDslBundleService.parse_bundle(content)
    extra = None
    if corruption == "marker":
        bundle.documents["app_1"]["bundle_id"] = "wrong"
    elif corruption == "relationship":
        bundle.manifest.relationships = [
            relation for relation in bundle.manifest.relationships if relation.source != "app_1"
        ]
    elif corruption == "traversal":
        bundle.manifest.apps["app_1"].file = "../escape.yaml"
    elif corruption == "unknown_file":
        extra = ("unexpected.yaml", "unexpected")
    elif corruption == "app_mode":
        bundle.documents["app_1"]["app"]["mode"] = "advanced-chat"
    else:
        bundle.documents["app_1"]["alias"] = bundle.documents["app_1"]
    with pytest.raises(ValueError):
        AppDslBundleService.parse_bundle(_archive(bundle, extra))


@pytest.mark.parametrize(
    "corruption", ["version", "resource_kind", "relationship_kind", "duplicate_relationship", "incompatible_target"]
)
def test_rejects_unsupported_manifest_extensions_before_import(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, corruption: str
) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle = AppDslBundleService.parse_bundle(content)
    manifest = bundle.manifest.model_dump(mode="json")
    if corruption == "version":
        manifest["version"] = "99"
    elif corruption == "resource_kind":
        manifest["resources"]["app_1"]["kind"] = "future_resource"
    elif corruption == "relationship_kind":
        manifest["relationships"][0]["kind"] = "future_relationship"
    elif corruption == "duplicate_relationship":
        manifest["relationships"].append(manifest["relationships"][0].copy())
    else:
        manifest["relationships"][0]["target"] = "app_1"
    with pytest.raises(ValueError):
        AppDslBundleService.parse_bundle(_archive(bundle, manifest=manifest))


def test_legacy_workflow_bundle_remains_importable(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle = AppDslBundleService.parse_bundle(content)
    workflows: dict[str, dict[str, object]] = {}
    for marker, resource in bundle.manifest.apps.items():
        assert resource.workflow is not None
        workflows[marker] = {
            "file": f"workflows/{marker}.yaml",
            "enable_api": resource.enable_api,
            "enable_site": resource.enable_site,
            **resource.workflow.model_dump(mode="json"),
        }
    tools = {}
    for marker, resource in bundle.manifest.tools.items():
        tools[marker] = {"workflow": resource.app, **resource.model_dump(mode="json", exclude={"kind", "app"})}
    legacy_manifest = {
        "kind": "workflow_bundle",
        "version": "1",
        "entrypoint": bundle.manifest.entrypoint,
        "workflows": workflows,
        "tools": tools,
        "relationships": {
            marker: [relation.target for relation in bundle.manifest.relationships if relation.source == marker]
            for marker in bundle.documents
        },
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", yaml.safe_dump(legacy_manifest))
        for marker, document in bundle.documents.items():
            archive.writestr(cast(str, workflows[marker]["file"]), yaml.safe_dump(document))
    service = AppDslBundleService(sqlite_session)
    restored = service.parse_bundle(output.getvalue())
    assert restored.manifest.kind == "app_bundle"
    assert restored.documents == bundle.documents
    destination = _account()
    imported = service.import_bundle(restored, account=destination, dsl_service=AppDslService(sqlite_session))
    sqlite_session.commit()
    exported = service.parse_bundle(service.export_bundle(imported, account=destination))
    assert exported.manifest == bundle.manifest
    assert exported.documents == bundle.documents


def test_workflow_reference_search_leaves_input_json_untouched() -> None:
    document = _document("Inputs", {})
    input_value = {"provider_type": "workflow", "provider_id": "not-a-tool", "tool_name": "text"}
    workflow = cast(WorkflowContentDict, document["workflow"])
    workflow["environment_variables"] = [{"name": "json", "value": input_value}]
    assert list(_tool_references(document)) == []
    agent_tool = {"type": "workflow", "provider_name": "agent-tool", "tool_name": "agent"}
    workflow["graph"]["nodes"].append(
        {"data": {"type": "agent", "agent_parameters": {"tools": {"value": [agent_tool]}}}}
    )
    assert list(_tool_references(document)) == [agent_tool]
    assert input_value["provider_id"] == "not-a-tool"


def test_agent_selectors_support_custom_parameter_names_and_legacy_slots() -> None:
    document = _document("Selectors", {})
    tool = {"provider_type": "workflow", "provider_id": "selected", "tool_name": "tool"}
    workflow = cast(WorkflowContentDict, document["workflow"])
    workflow["graph"]["nodes"].append(
        {
            "data": {
                "type": "agent",
                "tools": [copy.deepcopy(tool)],
                "agent_parameters": {
                    "single": {"value": copy.deepcopy(tool)},
                    "multiple": {"value": [copy.deepcopy(tool)]},
                    "ordinary_json": {"value": {"payload": copy.deepcopy(tool)}},
                },
            }
        }
    )
    assert len(list(_tool_references(document))) == 3


def test_export_rejects_cross_tenant_tool_and_nested_rbac_denial(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account, app, _ = _seed_bundle(sqlite_session, monkeypatch)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    caller = copy.copy(account)
    caller.id = str(uuid4())
    check = Mock(side_effect=[True, False])
    monkeypatch.setattr("services.app_dsl_bundle.RBACService.CheckAccess.check", check)
    with pytest.raises(NoPermissionError, match="bundled app"):
        AppDslBundleService(sqlite_session).export_bundle(app, account=caller)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    provider = sqlite_session.scalar(select(WorkflowToolProvider))
    assert provider is not None
    provider.tenant_id = str(uuid4())
    sqlite_session.flush()
    with pytest.raises(ValueError, match="current workspace"):
        AppDslBundleService(sqlite_session).export_bundle(app, account=account)


def test_agent_bundle_export_uses_backing_agent_permission(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account, _, _ = _seed_bundle(sqlite_session, monkeypatch)
    app = AppDslService(sqlite_session)._create_or_update_app(
        app=None, data=_app_document(AppMode.AGENT, {}), account=account, commit=False
    )
    sqlite_session.commit()
    agent = app.agent_app_binding_with_session(session=sqlite_session)
    assert agent is not None
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    check = Mock(return_value=False)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", check)
    with pytest.raises(NoPermissionError, match="Agent DSL"):
        AppDslBundleService(sqlite_session).export_bundle(app, account=account)
    check.assert_called_once_with(
        account.current_tenant_id,
        account.id,
        scene=RBACPermission.AGENT_IMPORT_EXPORT_DSL,
        resource_type=RBACResourceScope.AGENT,
        resource_id=agent.id,
    )


def test_single_app_bundle_keeps_yaml_import_permissions(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account, _, _ = _seed_bundle(sqlite_session, monkeypatch)
    app = AppDslService(sqlite_session)._create_or_update_app(
        app=None, data=_app_document(AppMode.CHAT, {}), account=account, commit=False
    )
    sqlite_session.commit()
    service = AppDslBundleService(sqlite_session)
    bundle = service.parse_bundle(service.export_bundle(app, account=account))
    assert not bundle.manifest.tools
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    check = Mock(return_value=False)
    monkeypatch.setattr("services.app_dsl_bundle.RBACService.CheckAccess.check", check)
    imported = service.import_bundle(bundle, account=_account(), dsl_service=AppDslService(sqlite_session))
    sqlite_session.commit()
    assert imported.mode == AppMode.CHAT
    check.assert_not_called()
