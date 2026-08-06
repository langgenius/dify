from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest
import yaml
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rbac import RBACPermission
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from models import App, AppMode
from models.model import AppModelConfig, AppModelConfigDict, IconType
from models.workflow import Workflow
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import ImportStatus
from services.errors.account import NoPermissionError


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
