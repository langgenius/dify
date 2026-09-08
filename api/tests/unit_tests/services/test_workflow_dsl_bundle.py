import copy
import io
import json
import zipfile
from unittest.mock import Mock
from uuid import uuid4

import pytest
import yaml
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration
from models import Account, App, Tenant
from models.account import TenantAccountRole
from models.tools import ToolLabelBinding, WorkflowToolProvider
from services.app_dsl_service import AppDslService
from services.errors.account import NoPermissionError
from services.workflow_dsl_bundle import WorkflowDslBundle, WorkflowDslBundleService, _tool_references
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


def _document(name: str, tools: dict[str, str]) -> dict:
    nodes = [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}]
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


def _seed_bundle(session: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[Account, App, bytes]:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False, DEPLOYMENT_EDITION="SELF_HOSTED")
    monkeypatch.setattr("services.app_dsl_service.app_was_created", Mock())
    monkeypatch.setattr("services.workflow_dsl_bundle.app_published_workflow_was_updated", Mock())
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
    session.add(ToolLabelBinding(tool_id=b_id, tool_type="workflow", label_name="search"))
    session.commit()
    # Published tool versions must be exported even when their drafts have since changed.
    draft = WorkflowService().get_draft_workflow(apps[1], session=session)
    assert draft is not None
    draft.graph = json.dumps(_document("Changed draft", {})["workflow"]["graph"])
    session.commit()
    content = WorkflowDslBundleService(session).export_bundle(apps[0], account=account)
    assert content is not None
    return account, apps[0], content


def _archive(bundle: WorkflowDslBundle, extra: tuple[str, str] | None = None) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", yaml.safe_dump(bundle.manifest.model_dump(mode="json")))
        for marker, document in bundle.documents.items():
            archive.writestr(bundle.manifest.workflows[marker].file, yaml.safe_dump(document))
        if extra:
            archive.writestr(*extra)
    return output.getvalue()


def test_nested_shared_cyclic_tools_round_trip_with_independent_files(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_account, source, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle_service = WorkflowDslBundleService(sqlite_session)
    bundle = bundle_service.parse_bundle(content)
    assert len(bundle.documents) == 3
    assert len(bundle.manifest.tools) == 2
    assert sorted(len(references) for references in bundle.manifest.relationships.values()) == [1, 1, 2]
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert len(archive.namelist()) == 4
    destination = _account()
    signal = Mock()
    monkeypatch.setattr("services.workflow_dsl_bundle.app_published_workflow_was_updated", signal)
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


def test_late_invalid_tool_deployment_rolls_back_all_workflows(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    service = WorkflowDslBundleService(sqlite_session)
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
    service = WorkflowDslBundleService(sqlite_session)
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
    service = WorkflowDslBundleService(sqlite_session)
    signal = Mock()
    monkeypatch.setattr("services.workflow_dsl_bundle.app_published_workflow_was_updated", signal)
    service.import_bundle(service.parse_bundle(content), account=_account(), dsl_service=AppDslService(sqlite_session))
    sqlite_session.rollback()
    sqlite_session.commit()
    signal.send.assert_not_called()


def test_bundle_quota_counts_every_new_app(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    service = WorkflowDslBundleService(sqlite_session)
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION="CLOUD")
    features = Mock()
    features.apps.size = 8
    features.apps.limit = 10
    monkeypatch.setattr("services.workflow_dsl_bundle.FeatureService.get_features", Mock(return_value=features))
    with pytest.raises(ValueError, match="subscription limit"):
        service.import_bundle(
            service.parse_bundle(content), account=_account(), dsl_service=AppDslService(sqlite_session)
        )
    assert not sqlite_session.new


def test_overwrite_activation_change_requires_release_permission(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account, app, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle = WorkflowDslBundleService.parse_bundle(content)
    bundle.manifest.workflows[bundle.manifest.entrypoint].enable_api = not app.enable_api
    caller = copy.copy(account)
    caller.id = str(uuid4())
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        "services.workflow_dsl_bundle.RBACService.CheckAccess.check", Mock(side_effect=[True, True, False])
    )
    with pytest.raises(NoPermissionError, match="release permission"):
        WorkflowDslBundleService(sqlite_session).import_bundle(
            bundle, account=caller, app=app, dsl_service=AppDslService(sqlite_session)
        )


@pytest.mark.parametrize("corruption", ["marker", "relationship", "traversal", "unknown_file", "app_mode", "alias"])
def test_rejects_invalid_archive_before_import(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, corruption: str
) -> None:
    _, _, content = _seed_bundle(sqlite_session, monkeypatch)
    bundle = WorkflowDslBundleService.parse_bundle(content)
    extra = None
    if corruption == "marker":
        bundle.documents["workflow_1"]["bundle_id"] = "wrong"
    elif corruption == "relationship":
        bundle.manifest.relationships["workflow_1"] = []
    elif corruption == "traversal":
        bundle.manifest.workflows["workflow_1"].file = "../escape.yaml"
    elif corruption == "unknown_file":
        extra = ("unexpected.yaml", "unexpected")
    elif corruption == "app_mode":
        bundle.documents["workflow_1"]["app"]["mode"] = "advanced-chat"
    else:
        bundle.documents["workflow_1"]["alias"] = bundle.documents["workflow_1"]
    with pytest.raises(ValueError):
        WorkflowDslBundleService.parse_bundle(_archive(bundle, extra))


def test_workflow_reference_search_leaves_input_json_untouched() -> None:
    document = _document("Inputs", {})
    input_value = {"provider_type": "workflow", "provider_id": "not-a-tool", "tool_name": "text"}
    document["workflow"]["environment_variables"] = [{"name": "json", "value": input_value}]
    assert list(_tool_references(document)) == []
    agent_tool = {"type": "workflow", "provider_name": "agent-tool", "tool_name": "agent"}
    document["workflow"]["graph"]["nodes"].append(
        {"data": {"type": "agent", "agent_parameters": {"tools": {"value": [agent_tool]}}}}
    )
    assert list(_tool_references(document)) == [agent_tool]
    assert input_value["provider_id"] == "not-a-tool"


def test_agent_selectors_support_custom_parameter_names_and_legacy_slots() -> None:
    document = _document("Selectors", {})
    tool = {"provider_type": "workflow", "provider_id": "selected", "tool_name": "tool"}
    document["workflow"]["graph"]["nodes"].append(
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
    monkeypatch.setattr("services.workflow_dsl_bundle.RBACService.CheckAccess.check", check)
    with pytest.raises(NoPermissionError, match="referenced workflow"):
        WorkflowDslBundleService(sqlite_session).export_bundle(app, account=caller)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    provider = sqlite_session.scalar(select(WorkflowToolProvider))
    assert provider is not None
    provider.tenant_id = str(uuid4())
    sqlite_session.flush()
    with pytest.raises(ValueError, match="current workspace"):
        WorkflowDslBundleService(sqlite_session).export_bundle(app, account=account)
