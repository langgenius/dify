from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest
import yaml
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rbac import RBACPermission, RBACResourceScope
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from models import App, AppMode
from models.model import AppModelConfig, AppModelConfigDict, IconType
from models.workflow import Workflow
from services.app_dsl_service import AppDslService, PendingData
from services.entities.dsl_entities import ImportStatus
from services.errors.account import NoPermissionError
from services.errors.app import WorkflowNotFoundError

_OVERWRITE_APP_ID = "11111111-1111-4111-8111-111111111111"
_TENANT_ID = "22222222-2222-4222-8222-222222222222"
_CALLER_ID = "33333333-3333-4333-8333-333333333333"
_OTHER_ACCOUNT_ID = "44444444-4444-4444-8444-444444444444"
_PENDING_WORKFLOW_DSL = "version: 99.0.0\nkind: app\napp: {name: Test, mode: workflow}\n"
_PENDING_DATA_JSON = PendingData(
    tenant_id=_TENANT_ID,
    account_id=_CALLER_ID,
    import_mode="yaml-content",
    yaml_content=_PENDING_WORKFLOW_DSL,
    app_id=_OVERWRITE_APP_ID,
).model_dump_json()


def _persist_overwrite_target(session: Session, *, maintainer: str = _OTHER_ACCOUNT_ID) -> App:
    app = App(
        id=_OVERWRITE_APP_ID,
        tenant_id=_TENANT_ID,
        name="Target",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
        created_by=maintainer,
        maintainer=maintainer,
        updated_by=maintainer,
    )
    session.add(app)
    session.commit()
    return app


def test_extract_workflow_dependencies_uses_llm_environment_variable_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        graph_dict={
            "nodes": [
                {
                    "id": "llm-node",
                    "data": {
                        "type": "llm",
                        "title": "LLM",
                        "model": {"provider": "old-provider", "name": "old-model", "mode": "chat"},
                        "model_selector": ["env", "shared_model"],
                        "prompt_template": [{"role": "system", "text": "x"}],
                        "context": {"enabled": False, "variable_selector": []},
                        "vision": {"enabled": False},
                    },
                }
            ]
        },
        environment_variables=[
            LLMEnvironmentVariable(
                name="shared_model",
                value={"provider": "new-provider", "name": "new-model", "mode": "chat"},
            )
        ],
    )
    analyze_dependency = Mock(side_effect=lambda provider: provider)
    monkeypatch.setattr(
        "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        analyze_dependency,
    )

    result = AppDslService._extract_dependencies_from_workflow(cast(Workflow, workflow))

    assert result == ["new-provider"]
    analyze_dependency.assert_called_once_with("new-provider")


@pytest.mark.parametrize("model_selector", [[], ["env", "missing_model"]])
def test_extract_workflow_dependencies_tolerates_unresolved_llm_environment_reference(
    monkeypatch: pytest.MonkeyPatch, model_selector: list[str]
) -> None:
    workflow = SimpleNamespace(
        graph_dict={
            "nodes": [
                {
                    "id": "llm-node",
                    "data": {
                        "type": "llm",
                        "title": "LLM",
                        "model": {"provider": "old-provider", "name": "old-model", "mode": "chat"},
                        "model_selector": model_selector,
                        "prompt_template": [{"role": "system", "text": "x"}],
                        "context": {"enabled": False, "variable_selector": []},
                        "vision": {"enabled": False},
                    },
                }
            ]
        },
        environment_variables=[],
    )
    analyze_dependency = Mock(side_effect=lambda provider: provider)
    monkeypatch.setattr(
        "services.app_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        analyze_dependency,
    )

    result = AppDslService._extract_dependencies_from_workflow(cast(Workflow, workflow))

    assert result == ["old-provider"]
    analyze_dependency.assert_called_once_with("old-provider")


def test_import_app_rejects_oversized_yaml_content_before_parsing(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 3)
    service = AppDslService(session=unbound_session)
    account = Mock(current_tenant_id="tenant-1")

    result = service.import_app(account=account, import_mode="yaml-content", yaml_content="你你")

    assert result.status == ImportStatus.FAILED
    assert result.error == "File size exceeds the limit of 10MB"
    assert not unbound_session.in_transaction()


def test_import_app_rejects_oversized_yaml_url_bytes_before_decode(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 1)
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=unbound_session)

    result = service.import_app(
        account=Mock(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "File size exceeds the limit of 10MB"
    assert not unbound_session.in_transaction()


def test_import_app_returns_decode_error_for_invalid_yaml_url_bytes(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=unbound_session)

    result = service.import_app(
        account=Mock(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "utf-8" in result.error
    assert not unbound_session.in_transaction()


def test_import_app_checks_overwrite_rbac_before_database_access(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_overwrite_target(sqlite_session)
    account = Mock(id=_CALLER_ID, current_tenant_id=_TENANT_ID)

    def deny_before_transaction(*_args: object, **_kwargs: object) -> bool:
        assert not sqlite_session.in_transaction()
        return False

    check = Mock(side_effect=deny_before_transaction)
    setex = Mock()
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", check)
    monkeypatch.setattr("services.app_dsl_service.redis_client.setex", setex)

    with pytest.raises(NoPermissionError, match="permission to overwrite"):
        AppDslService(sqlite_session).import_app(
            account=account,
            import_mode="yaml-content",
            yaml_content=_PENDING_WORKFLOW_DSL,
            app_id=_OVERWRITE_APP_ID,
        )

    check.assert_called_once_with(
        _TENANT_ID,
        _CALLER_ID,
        scene=RBACPermission.APP_IMPORT_EXPORT_DSL,
        resource_type=RBACResourceScope.APP,
        resource_id=_OVERWRITE_APP_ID,
    )
    setex.assert_not_called()


def test_confirm_import_rechecks_overwrite_rbac_before_database_access(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    _persist_overwrite_target(sqlite_session)
    monkeypatch.setattr("services.app_dsl_service.redis_client.get", Mock(return_value=_PENDING_DATA_JSON))
    redis_delete = Mock()
    monkeypatch.setattr("services.app_dsl_service.redis_client.delete", redis_delete)
    create_or_update = Mock()
    service = AppDslService(sqlite_session)
    monkeypatch.setattr(service, "_create_or_update_app", create_or_update)

    def deny_before_transaction(*_args: object, **_kwargs: object) -> bool:
        assert not sqlite_session.in_transaction()
        return False

    check = Mock(side_effect=deny_before_transaction)
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", check)

    with pytest.raises(NoPermissionError, match="permission to overwrite"):
        service.confirm_import(
            import_id="import-1",
            account=Mock(id=_CALLER_ID, current_tenant_id=_TENANT_ID),
        )

    check.assert_called_once_with(
        _TENANT_ID,
        _CALLER_ID,
        scene=RBACPermission.APP_IMPORT_EXPORT_DSL,
        resource_type=RBACResourceScope.APP,
        resource_id=_OVERWRITE_APP_ID,
    )
    create_or_update.assert_not_called()
    redis_delete.assert_not_called()


def test_confirm_import_does_not_create_when_overwrite_target_disappeared(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.redis_client.get", Mock(return_value=_PENDING_DATA_JSON))
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", Mock(return_value=True))
    redis_delete = Mock()
    monkeypatch.setattr("services.app_dsl_service.redis_client.delete", redis_delete)
    service = AppDslService(sqlite_session)
    create_or_update = Mock()
    monkeypatch.setattr(service, "_create_or_update_app", create_or_update)

    result = service.confirm_import(
        import_id="import-1",
        account=Mock(id=_CALLER_ID, current_tenant_id=_TENANT_ID),
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "App not found"
    create_or_update.assert_not_called()
    redis_delete.assert_not_called()


def test_pending_import_is_scoped_to_its_owner(monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
    pending_imports: dict[str, str] = {}
    monkeypatch.setattr(
        "services.app_dsl_service.redis_client.setex",
        lambda key, _expiry, value: pending_imports.__setitem__(key, value),
    )
    service = AppDslService(session=unbound_session)
    creator = Mock(id="account-1", current_tenant_id="tenant-1")

    pending = service.import_app(
        account=creator,
        import_mode="yaml-content",
        yaml_content="version: 99.0.0\nkind: app\napp: {name: Test, mode: workflow}\n",
    )

    redis_key = f"app_import_info:{pending.id}"
    assert pending.status == ImportStatus.PENDING
    assert redis_key in pending_imports
    pending_data = PendingData.model_validate_json(pending_imports[redis_key])
    assert pending_data.tenant_id == "tenant-1"
    assert pending_data.account_id == "account-1"

    monkeypatch.setattr("services.app_dsl_service.redis_client.get", pending_imports.get)
    monkeypatch.setattr("services.app_dsl_service.redis_client.delete", pending_imports.pop)
    monkeypatch.setattr(
        service,
        "_create_or_update_app",
        Mock(return_value=Mock(id="app-1", mode=AppMode.WORKFLOW)),
    )

    for other_account in (
        Mock(id="account-1", current_tenant_id="tenant-2"),
        Mock(id="account-2", current_tenant_id="tenant-1"),
    ):
        assert service.confirm_import(import_id=pending.id, account=other_account).status == ImportStatus.FAILED

    assert service.confirm_import(import_id=pending.id, account=creator).status == ImportStatus.COMPLETED
    assert redis_key not in pending_imports


@pytest.mark.parametrize(
    ("tenant_id", "account_id", "expected"),
    [
        ("tenant-1", "account-1", True),
        (None, "account-1", False),
        ("tenant-1", None, False),
        ("tenant-2", "account-1", False),
        ("tenant-1", "account-2", False),
    ],
)
def test_pending_import_owner_access(
    tenant_id: str | None,
    account_id: str | None,
    expected: bool,
) -> None:
    pending = PendingData(
        tenant_id=tenant_id,
        account_id=account_id,
        import_mode="yaml-content",
        yaml_content="",
    )

    assert pending.is_accessible_by(tenant_id="tenant-1", account_id="account-1") is expected


def test_pending_import_owner_access_accepts_legacy_json() -> None:
    pending = PendingData.model_validate_json('{"import_mode":"yaml-content","yaml_content":""}')

    assert pending.is_accessible_by(tenant_id="tenant-1", account_id="account-1")
    assert not pending.is_accessible_by(tenant_id=None, account_id="account-1")


def test_create_or_update_app_loads_existing_model_config_with_service_session(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory() as arrange_session:
        app_model_config = AppModelConfig(
            app_id="11111111-1111-1111-1111-111111111111",
            created_by="22222222-2222-2222-2222-222222222222",
            updated_by="22222222-2222-2222-2222-222222222222",
        )
        arrange_session.add(app_model_config)
        arrange_session.commit()
        app_model_config_id = app_model_config.id
    app = cast(
        App,
        SimpleNamespace(
            id="11111111-1111-1111-1111-111111111111",
            tenant_id="33333333-3333-3333-3333-333333333333",
            app_model_config_id=app_model_config_id,
            name="Existing app",
            description="",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
        ),
    )

    with sqlite_session_factory() as service_session:
        result = AppDslService(session=service_session)._create_or_update_app(
            app=app,
            data={"app": {"mode": AppMode.CHAT}, "model_config": {"model": {}}},
            account=Mock(id="account-1"),
        )

        assert result is app
        assert app.app_model_config_id == app_model_config_id
        configs = list(service_session.scalars(select(AppModelConfig)))
        assert [config.id for config in configs] == [app_model_config_id]


def test_create_or_update_app_flushes_new_model_config_before_signal(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    events: list[str] = []

    def record_flush(_session: Session, _flush_context: object) -> None:
        events.append("flush")

    def record_signal(*_args: object, **_kwargs: object) -> None:
        events.append("signal")

    event.listen(sqlite_session, "after_flush", record_flush)
    signal = Mock()
    signal.send.side_effect = record_signal
    monkeypatch.setattr("services.app_dsl_service.app_model_config_was_updated", signal)
    app = cast(
        App,
        SimpleNamespace(
            id="11111111-1111-1111-1111-111111111111",
            tenant_id="33333333-3333-3333-3333-333333333333",
            app_model_config_id=None,
            name="Existing app",
            description="",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
        ),
    )

    try:
        AppDslService(session=sqlite_session)._create_or_update_app(
            app=app,
            data={"app": {"mode": AppMode.CHAT}, "model_config": {"model": {}}},
            account=Mock(id="22222222-2222-2222-2222-222222222222"),
        )
    finally:
        event.remove(sqlite_session, "after_flush", record_flush)

    assert events == ["flush", "signal"]
    assert signal.send.call_args.kwargs["session"] is sqlite_session
    assert app.app_model_config_id is not None
    assert sqlite_session.get(AppModelConfig, app.app_model_config_id) is not None
    assert sqlite_session.in_transaction()


def test_create_or_update_app_forwards_imported_agent_purge_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    session = cast(Session, SimpleNamespace(add=Mock(), flush=Mock(), commit=Mock(), get=Mock()))
    service = AppDslService(session=session)
    app = SimpleNamespace(
        id="app-1",
        tenant_id="tenant-1",
        name="Workflow",
        description="",
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
    )
    workflow = SimpleNamespace(id="workflow-1")
    workflow_service = SimpleNamespace(
        get_draft_workflow=Mock(return_value=None),
        sync_draft_workflow=Mock(return_value=workflow),
    )
    monkeypatch.setattr("services.app_dsl_service.WorkflowService", Mock(return_value=workflow_service))
    monkeypatch.setattr(
        "services.app_dsl_service.AgentDslService.graph_without_package_bindings",
        Mock(return_value={"nodes": [], "edges": []}),
    )
    monkeypatch.setattr(
        "services.app_dsl_service.AgentDslService.import_workflow_packages",
        Mock(return_value=(workflow, [], {"retired-agent"})),
    )
    monkeypatch.setattr(
        "services.app_dsl_service.WorkflowAgentPublishService.validate_agent_nodes_for_draft_sync",
        Mock(),
    )
    retire_unowned = Mock()
    monkeypatch.setattr(
        "services.app_dsl_service.WorkflowAgentRetirementService.retire_unowned",
        retire_unowned,
    )

    service._create_or_update_app(
        app=cast(App, app),
        data={
            "app": {"mode": AppMode.WORKFLOW.value},
            "workflow": {"graph": {"nodes": [], "edges": []}},
            "agent_packages": {"package-1": {}},
        },
        account=Mock(id="account-1"),
    )

    retire_unowned.assert_called_once_with(
        tenant_id="tenant-1",
        agent_ids={"retired-agent"},
        account_id="account-1",
    )


def test_export_dsl_loads_model_config_and_annotation_reply_with_request_session(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    model_config = cast(AppModelConfigDict, {"model": {}, "agent_mode": {"tools": []}})
    with sqlite_session_factory() as arrange_session:
        app_model_config = AppModelConfig(
            app_id="11111111-1111-1111-1111-111111111111",
            created_by="22222222-2222-2222-2222-222222222222",
            updated_by="22222222-2222-2222-2222-222222222222",
        ).from_model_config_dict(model_config)
        arrange_session.add(app_model_config)
        arrange_session.commit()
        app_model_config_id = app_model_config.id
        app_id = app_model_config.app_id
    annotation_reply = {"enabled": False}
    load_annotation_reply_config = Mock(return_value=annotation_reply)
    monkeypatch.setattr("services.app_dsl_service.load_annotation_reply_config", load_annotation_reply_config)
    monkeypatch.setattr(
        "services.app_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )
    app = cast(
        App,
        SimpleNamespace(
            id="11111111-1111-1111-1111-111111111111",
            tenant_id="33333333-3333-3333-3333-333333333333",
            app_model_config_id=app_model_config_id,
            mode=AppMode.CHAT,
            name="Chat app",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
            description="",
            use_icon_as_answer_icon=False,
        ),
    )

    with sqlite_session_factory() as service_session:
        exported = AppDslService.export_dsl(app, session=service_session)

        export_data = yaml.safe_load(exported)
        assert export_data["model_config"]["model"] == {}
        assert export_data["model_config"]["annotation_reply"] == annotation_reply
        load_annotation_reply_config.assert_called_once_with(service_session, app_id)


def test_ensure_agent_manage_permission_noops_when_rbac_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", False)
    check = Mock()
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", check)

    AppDslService._ensure_agent_manage_permission(Mock(id="account-1", current_tenant_id="tenant-1"))

    check.assert_not_called()


def test_ensure_agent_manage_permission_allows_agent_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", True)
    check = Mock(return_value=True)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", check)

    AppDslService._ensure_agent_manage_permission(Mock(id="account-1", current_tenant_id="tenant-1"))

    check.assert_called_once_with("tenant-1", "account-1", scene=RBACPermission.AGENT_MANAGE)


def test_ensure_agent_manage_permission_rejects_without_agent_manage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", Mock(return_value=False))

    with pytest.raises(NoPermissionError):
        AppDslService._ensure_agent_manage_permission(Mock(id="account-1", current_tenant_id="tenant-1"))


def test_create_or_update_app_gates_agent_mode_before_creation(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", Mock(return_value=False))
    service = AppDslService(session=unbound_session)

    with pytest.raises(NoPermissionError):
        service._create_or_update_app(
            app=None,
            data={"app": {"mode": "agent", "name": "Gated agent"}},
            account=Mock(id="account-1", current_tenant_id="tenant-1"),
        )

    assert not unbound_session.in_transaction()


def test_import_app_reraises_permission_denial_instead_of_failed_result(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.dify_config.RBAC_ENABLED", True)
    monkeypatch.setattr("services.app_dsl_service.RBACService.CheckAccess.check", Mock(return_value=False))
    service = AppDslService(session=unbound_session)

    with pytest.raises(NoPermissionError):
        service.import_app(
            account=Mock(id="account-1", current_tenant_id="tenant-1"),
            import_mode="yaml-content",
            yaml_content="app:\n  mode: agent\n  name: Denied agent\n",
        )

    assert not unbound_session.in_transaction()


def test_append_workflow_export_data_reports_missing_selected_workflow(monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_id = "11111111-1111-4111-8111-111111111111"
    workflow_service = Mock()
    workflow_service.get_draft_workflow.return_value = None
    monkeypatch.setattr("services.app_dsl_service.WorkflowService", Mock(return_value=workflow_service))
    app = cast(App, SimpleNamespace(id="app-1", tenant_id="tenant-1"))

    with pytest.raises(WorkflowNotFoundError, match=f"Workflow version not found. Workflow ID: {workflow_id}"):
        AppDslService._append_workflow_export_data(
            export_data={},
            app_model=app,
            include_secret=False,
            session=Mock(),
            workflow_id=workflow_id,
        )
