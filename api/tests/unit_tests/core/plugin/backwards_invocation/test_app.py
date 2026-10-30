import json
from collections.abc import Generator
from typing import cast
from unittest.mock import create_autospec

import pytest
from pydantic import BaseModel
from pytest_mock import MockerFixture
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from models import Account, Tenant, TenantAccountJoin
from models.enums import EndUserType
from models.model import App, AppMode, AppModelConfig, EndUser
from models.workflow import Workflow
from services.knowledge.retrieval.retrieval import KnowledgeRetriever
from services.plugin.app_invocation import PluginAppInvocationService
from services.workflow_run_agg import WorkflowRunAgg
from tests.helpers.unit.model_factories import make_app, make_end_user, make_workflow


class _Chunk(BaseModel):
    value: int


class _EndUserProvisioner:
    def __init__(self) -> None:
        self.result: EndUser | None = None
        self.calls: list[tuple[str, str, str | None]] = []

    def get_or_create_end_user(
        self,
        tenant_id: str,
        app_id: str,
        user_id: str | None = None,
    ) -> EndUser:
        self.calls.append((tenant_id, app_id, user_id))
        if self.result is None:
            raise AssertionError("unexpected end-user provisioning")
        return self.result


def _app(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    mode: AppMode = AppMode.WORKFLOW,
    workflow_id: str | None = None,
    app_model_config_id: str | None = None,
) -> App:
    return make_app(
        app_id=app_id,
        tenant_id=tenant_id,
        name="Plugin app",
        mode=mode,
        icon_type=None,
        workflow_id=workflow_id,
        app_model_config_id=app_model_config_id,
        enable_site=False,
        enable_api=False,
    )


def _workflow(*, workflow_id: str = "workflow-1", app_id: str = "app-1", tenant_id: str = "tenant-1") -> Workflow:
    return make_workflow(workflow_id=workflow_id, tenant_id=tenant_id, app_id=app_id, graph="{}")


def _end_user(
    *,
    user_id: str = "user-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    session_id: str = "browser-session",
) -> EndUser:
    return make_end_user(
        end_user_id=user_id,
        tenant_id=tenant_id,
        app_id=app_id,
        session_id=session_id,
        name="Browser user",
    )


class TestBaseBackwardsInvocation:
    def test_convert_to_event_stream_with_generator_and_error(self) -> None:
        def _stream() -> Generator[_Chunk | dict[str, int] | str]:
            yield _Chunk(value=1)
            yield {"x": 2}
            yield "ignored"
            raise RuntimeError("boom")

        chunks = list(BaseBackwardsInvocation.convert_to_event_stream(_stream()))

        assert len(chunks) == 3
        first = json.loads(chunks[0].decode())
        second = json.loads(chunks[1].decode())
        error = json.loads(chunks[2].decode())
        assert first["data"]["value"] == 1
        assert second["data"]["x"] == 2
        assert error["error"] == "boom"

    def test_convert_to_event_stream_with_non_generator(self) -> None:
        chunks = list(BaseBackwardsInvocation.convert_to_event_stream({"ok": True}))
        payload = json.loads(chunks[0].decode())
        assert payload["data"] == {"ok": True}
        assert payload["error"] == ""


class TestPluginAppInvocationService:
    session: Session
    session_factory: sessionmaker[Session]
    sqlite_engine: Engine
    end_users: _EndUserProvisioner
    knowledge_retrieval: KnowledgeRetriever
    service: PluginAppInvocationService

    @pytest.fixture(autouse=True)
    def _real_sessions(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_engine: Engine,
    ) -> None:
        self.session = sqlite_session
        self.session_factory = sqlite_session_factory
        self.sqlite_engine = sqlite_engine
        self.end_users = _EndUserProvisioner()
        self.knowledge_retrieval = create_autospec(KnowledgeRetriever, instance=True, spec_set=True)
        self.service = PluginAppInvocationService(
            session_factory=sqlite_session_factory,
            execution_driver=WorkflowRunAgg.run,
            end_users=self.end_users,
            knowledge_retrieval=self.knowledge_retrieval,
        )

    def test_fetch_app_info_workflow_path(self, mocker: MockerFixture) -> None:
        variable = {"type": "text-input", "variable": "foo", "label": "Foo", "required": False}
        workflow = _workflow()
        workflow.features = json.dumps({"feature": "v"})
        workflow.graph = json.dumps({"nodes": [{"data": {"type": "start", "variables": [variable]}}]})
        app = _app(mode=AppMode.WORKFLOW)
        mocker.patch.object(self.service, "_get_app", return_value=app)
        mocker.patch.object(self.service, "_get_workflow", return_value=workflow)
        mapper = mocker.patch(
            "services.plugin.app_invocation.get_parameters_from_feature_dict",
            return_value={"mapped": True},
        )

        result = self.service.fetch_app_info("app-1", "tenant-1")

        assert result == {"data": {"mapped": True}}
        mapper.assert_called_once_with(features_dict={"feature": "v"}, user_input_form=[{"text-input": variable}])

    def test_fetch_app_info_model_config_path(self, mocker: MockerFixture) -> None:
        model_config_dict = {"user_input_form": [{"name": "bar"}], "k": "v"}
        app = _app(mode=AppMode.COMPLETION)
        mocker.patch.object(self.service, "_get_app", return_value=app)
        mocker.patch.object(self.service, "_get_app_model_config_dict", return_value=model_config_dict)
        mocker.patch(
            "services.plugin.app_invocation.get_parameters_from_feature_dict",
            return_value={"mapped": True},
        )

        result = self.service.fetch_app_info("app-1", "tenant-1")

        assert result["data"] == {"mapped": True}

    @pytest.mark.parametrize(
        ("mode", "route_method"),
        [
            (AppMode.CHAT, "invoke_chat_app"),
            (AppMode.ADVANCED_CHAT, "invoke_chat_app"),
            (AppMode.AGENT_CHAT, "invoke_chat_app"),
            (AppMode.WORKFLOW, "invoke_workflow_app"),
            (AppMode.COMPLETION, "invoke_completion_app"),
        ],
    )
    def test_invoke_app_routes_by_mode(self, mocker: MockerFixture, mode: AppMode, route_method: str) -> None:
        app = _app(mode=mode)
        user = _end_user()
        workflow = _workflow()
        mocker.patch.object(self.service, "_get_app", return_value=app)
        mocker.patch.object(self.service, "_get_user", return_value=user)
        mocker.patch.object(self.service, "_get_workflow", return_value=workflow)
        route = mocker.patch.object(self.service, route_method, return_value={"routed": True})

        result = self.service.invoke_app(
            app_id="app",
            user_id="user",
            tenant_id="tenant",
            conversation_id=None,
            query="hello",
            stream=False,
            inputs={"x": 1},
            files=[],
            session=self.session,
        )

        assert result == {"routed": True}
        assert route.call_count == 1
        assert self.service._knowledge_retrieval is self.knowledge_retrieval

    def test_invoke_app_uses_end_user_when_user_id_missing(self, mocker: MockerFixture) -> None:
        app = _app(mode=AppMode.WORKFLOW)
        end_user = _end_user()
        workflow = _workflow()
        mocker.patch.object(self.service, "_get_app", return_value=app)
        mocker.patch.object(self.service, "_get_workflow", return_value=workflow)
        self.end_users.result = end_user
        route = mocker.patch.object(self.service, "invoke_workflow_app", return_value={"ok": True})

        result = self.service.invoke_app(
            app_id="app",
            user_id="",
            tenant_id="tenant",
            conversation_id="",
            query=None,
            stream=True,
            inputs={},
            files=[],
            session=self.session,
        )

        assert result == {"ok": True}
        assert self.end_users.calls == [(app.tenant_id, app.id, None)]
        assert route.call_args.args[1] is workflow
        assert route.call_args.args[2] is end_user

    def test_invoke_app_missing_query_for_chat_raises(self, mocker: MockerFixture) -> None:
        mocker.patch.object(self.service, "_get_app", return_value=_app(mode=AppMode.CHAT))
        mocker.patch.object(self.service, "_get_user", return_value=_end_user())

        with pytest.raises(ValueError, match="missing query"):
            self.service.invoke_app(
                app_id="app",
                user_id="user",
                tenant_id="tenant",
                conversation_id=None,
                query="",
                stream=False,
                inputs={},
                files=[],
                session=self.session,
            )

    def test_invoke_app_unexpected_mode_raises(self, mocker: MockerFixture) -> None:
        mocker.patch.object(
            self.service,
            "_get_app",
            return_value=_app(mode=cast(AppMode, "other")),
        )
        mocker.patch.object(self.service, "_get_user", return_value=_end_user())

        with pytest.raises(ValueError, match="unexpected app type"):
            self.service.invoke_app(
                app_id="app",
                user_id="user",
                tenant_id="tenant",
                conversation_id=None,
                query="q",
                stream=False,
                inputs={},
                files=[],
                session=self.session,
            )

    @pytest.mark.parametrize(
        ("mode", "generator_path", "expected_constructor_kwargs"),
        [
            (
                AppMode.AGENT_CHAT,
                "services.plugin.app_invocation.AgentChatAppGenerator",
                {"execution_driver": WorkflowRunAgg.run},
            ),
            (AppMode.CHAT, "services.plugin.app_invocation.ChatAppGenerator", {}),
        ],
    )
    def test_invoke_chat_app_agent_and_chat(
        self,
        mocker: MockerFixture,
        mode: AppMode,
        generator_path: str,
        expected_constructor_kwargs: dict[str, object],
    ) -> None:
        app = _app(mode=mode)
        generator = mocker.patch(generator_path)
        generator.return_value.generate.return_value = {"result": "ok"}

        result = self.service.invoke_chat_app(
            app=app,
            user=_end_user(),
            conversation_id="conv-1",
            query="hello",
            stream=False,
            inputs={"k": "v"},
            files=[],
            session=self.session,
        )

        assert result == {"result": "ok"}
        generator.assert_called_once_with(
            **expected_constructor_kwargs,
            knowledge_retrieval=self.knowledge_retrieval,
        )
        generator.return_value.generate.assert_called_once()

    def test_invoke_chat_app_advanced_chat_injects_pause_state_config(self, mocker: MockerFixture) -> None:
        workflow = _workflow()
        workflow.created_by = "owner-id"

        app = _app(mode=AppMode.ADVANCED_CHAT)
        mocker.patch.object(self.service, "_get_workflow", return_value=workflow)

        generator = mocker.patch("services.plugin.app_invocation.AdvancedChatAppGenerator")
        generator.return_value.generate.return_value = {"result": "ok"}
        session = self.session

        result = self.service.invoke_chat_app(
            app=app,
            user=_end_user(),
            conversation_id="conv-1",
            query="hello",
            stream=False,
            inputs={"k": "v"},
            files=[],
            session=session,
        )

        assert result == {"result": "ok"}
        generator.assert_called_once_with(
            execution_driver=WorkflowRunAgg.run,
            knowledge_retrieval=self.knowledge_retrieval,
        )
        call_kwargs = generator.return_value.generate.call_args.kwargs
        assert call_kwargs["session"] is session
        pause_state_config = call_kwargs.get("pause_state_config")
        assert isinstance(pause_state_config, PauseStateLayerConfig)
        assert pause_state_config.session_factory is self.session_factory
        assert pause_state_config.state_owner_user_id == "owner-id"

    def test_invoke_chat_app_advanced_chat_without_workflow_raises(self, mocker: MockerFixture) -> None:
        app = _app(mode=AppMode.ADVANCED_CHAT)
        mocker.patch.object(self.service, "_get_workflow", return_value=None)
        with pytest.raises(ValueError, match="unexpected app type"):
            self.service.invoke_chat_app(
                app=app,
                user=_end_user(),
                conversation_id="conv-1",
                query="hello",
                stream=False,
                inputs={},
                files=[],
                session=self.session,
            )

    def test_invoke_chat_app_unexpected_mode_raises(self) -> None:
        app = _app(mode=cast(AppMode, "invalid"))
        with pytest.raises(ValueError, match="unexpected app type"):
            self.service.invoke_chat_app(
                app=app,
                user=_end_user(),
                conversation_id="conv-1",
                query="hello",
                stream=False,
                inputs={},
                files=[],
                session=self.session,
            )

    def test_invoke_workflow_app_injects_pause_state_config(self, mocker: MockerFixture) -> None:
        workflow = _workflow()
        workflow.created_by = "owner-id"

        app = _app(mode=AppMode.WORKFLOW)

        generator = mocker.patch("services.plugin.app_invocation.WorkflowAppGenerator")
        generator.return_value.generate.return_value = {"result": "ok"}

        result = self.service.invoke_workflow_app(
            app=app,
            workflow=workflow,
            user=_end_user(),
            stream=False,
            inputs={"k": "v"},
            files=[],
        )

        assert result == {"result": "ok"}
        generator.assert_called_once_with(
            execution_driver=WorkflowRunAgg.run,
            knowledge_retrieval=self.knowledge_retrieval,
        )
        call_kwargs = generator.return_value.generate.call_args.kwargs
        pause_state_config = call_kwargs.get("pause_state_config")
        assert isinstance(pause_state_config, PauseStateLayerConfig)
        assert pause_state_config.session_factory is self.session_factory
        assert pause_state_config.state_owner_user_id == "owner-id"

    def test_invoke_app_workflow_without_workflow_raises(self, mocker: MockerFixture) -> None:
        app = _app(mode=AppMode.WORKFLOW)
        mocker.patch.object(self.service, "_get_app", return_value=app)
        mocker.patch.object(self.service, "_get_user", return_value=_end_user())
        mocker.patch.object(self.service, "_get_workflow", return_value=None)
        with pytest.raises(ValueError, match="unexpected app type"):
            self.service.invoke_app(
                app_id="app",
                user_id="user",
                tenant_id="tenant",
                conversation_id=None,
                query=None,
                stream=False,
                inputs={},
                files=[],
                session=self.session,
            )

    def test_invoke_completion_app(self, mocker: MockerFixture) -> None:
        generator = mocker.patch("services.plugin.app_invocation.CompletionAppGenerator")
        generator.return_value.generate.return_value = {"ok": 1}
        app = _app(mode=AppMode.COMPLETION)

        result = self.service.invoke_completion_app(
            app,
            _end_user(),
            False,
            {"x": 1},
            [],
            self.session,
        )

        assert result == {"ok": 1}
        generator.assert_called_once_with(knowledge_retrieval=self.knowledge_retrieval)
        generator.return_value.generate.assert_called_once()

    def test_get_user_returns_end_user(self) -> None:
        app = _app()
        end_user = EndUser(
            id="uid",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="browser-session",
            name="Browser user",
            _is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        user = self.service._get_user("uid", app)

        assert isinstance(user, EndUser)
        assert user.id == "uid"
        assert user.tenant_id == app.tenant_id
        assert user.app_id == app.id

    def test_get_user_returns_end_user_by_session_id(self) -> None:
        app = _app()
        end_user = EndUser(
            id="session-user",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="wecom-sender-1",
            name="External user",
            _is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        user = self.service._get_user("wecom-sender-1", app)

        assert user.id == "session-user"

    def test_get_user_rejects_end_user_from_another_app(self) -> None:
        app = _app()
        end_user = EndUser(
            id="uid",
            tenant_id=app.tenant_id,
            app_id="other-app",
            type=EndUserType.BROWSER,
            session_id="browser-session",
            name="Browser user",
            _is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            self.service._get_user("uid", app)

    def test_get_user_rejects_nonmatching_session_id(self) -> None:
        app = _app()
        end_user = EndUser(
            id="session-user",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="other-session",
            name="External user",
            _is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            self.service._get_user("wecom-sender-1", app)

    def test_get_user_falls_back_to_account_user(self) -> None:
        app = _app()
        tenant = Tenant(name="Plugin tenant")
        tenant.id = app.tenant_id
        account = Account(name="Account user", email="account-user@example.com")
        account.id = "account-user"
        membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id)
        self.session.add_all([tenant, account, membership])
        self.session.commit()

        user = self.service._get_user(account.id, app)

        assert user.id == "account-user"

    def test_get_user_rejects_account_from_another_tenant(self) -> None:
        app = _app()
        tenant = Tenant(name="Plugin tenant")
        tenant.id = "other-tenant"
        account = Account(name="Account user", email="account-user@example.com")
        account.id = "account-user"
        membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id)
        self.session.add_all([tenant, account, membership])
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            self.service._get_user(account.id, app)

    def test_get_user_raises_when_user_not_found(self) -> None:
        app = _app()
        other_tenant_user = EndUser(
            id="uid",
            tenant_id="other-tenant",
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="uid",
            name="Wrong tenant",
            _is_anonymous=True,
        )
        self.session.add(other_tenant_user)
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            self.service._get_user("uid", app)

    def test_invoke_app_creates_end_user_for_unknown_external_user_id(self, mocker: MockerFixture) -> None:
        app = _app(mode=AppMode.WORKFLOW)
        end_user = _end_user(session_id="wecom-sender-1")
        workflow = _workflow()
        mocker.patch.object(self.service, "_get_app", return_value=app)
        mocker.patch.object(self.service, "_get_workflow", return_value=workflow)
        mocker.patch.object(self.service, "_get_user", side_effect=ValueError("user not found"))
        self.end_users.result = end_user
        route = mocker.patch.object(self.service, "invoke_workflow_app", return_value={"ok": True})

        result = self.service.invoke_app(
            app_id="app",
            user_id="wecom-sender-1",
            tenant_id="tenant",
            conversation_id="",
            query=None,
            stream=True,
            inputs={},
            files=[],
            session=self.session,
        )

        assert result == {"ok": True}
        assert self.end_users.calls == [(app.tenant_id, app.id, "wecom-sender-1")]
        assert route.call_args.args[2] is end_user

    def test_get_app_returns_app(self) -> None:
        app_obj = _app(app_id="app", tenant_id="tenant")
        self.session.add(app_obj)
        self.session.commit()

        result = self.service._get_app("app", "tenant")
        assert result.id == app_obj.id
        assert result.tenant_id == app_obj.tenant_id

    def test_get_app_raises_when_missing(self) -> None:
        self.session.add(_app(app_id="app", tenant_id="other-tenant"))
        self.session.commit()

        with pytest.raises(ValueError, match="app not found"):
            self.service._get_app("app", "tenant")

    def test_get_app_raises_when_query_fails(self) -> None:
        def fail_query(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("db down")

        event.listen(self.sqlite_engine, "before_cursor_execute", fail_query, once=True)

        with pytest.raises(ValueError, match="app not found"):
            self.service._get_app("app", "tenant")

    def test_get_workflow_stays_inside_app_boundary(self) -> None:
        workflow = _workflow()
        other_workflow = _workflow(workflow_id="workflow-other", tenant_id="other-tenant")
        self.session.add_all([workflow, other_workflow])
        self.session.commit()
        app = _app(workflow_id="workflow-1")

        result = self.service._get_workflow(app)
        assert result is not None
        assert result.id == workflow.id
        assert result.tenant_id == app.tenant_id

    def test_get_workflow_rejects_workflow_from_another_tenant(self) -> None:
        workflow = _workflow(tenant_id="other-tenant")
        self.session.add(workflow)
        self.session.commit()
        app = _app(app_id=workflow.app_id, tenant_id="tenant-1", workflow_id=workflow.id)

        assert self.service._get_workflow(app) is None

    def test_get_workflow_rejects_workflow_from_another_app(self) -> None:
        workflow = _workflow(app_id="other-app")
        self.session.add(workflow)
        self.session.commit()
        app = _app(app_id="app-1", tenant_id=workflow.tenant_id, workflow_id=workflow.id)

        assert self.service._get_workflow(app) is None

    def test_get_app_model_config_dict_uses_explicit_session_for_annotation_reply(self, mocker: MockerFixture) -> None:
        annotation_reply = {"enabled": False}
        app_model_config = AppModelConfig(app_id="app-1", user_input_form=json.dumps([{"name": "bar"}]))
        app_model_config.id = "config-1"
        self.session.add(app_model_config)
        self.session.commit()
        load_annotation_reply_config = mocker.patch(
            "services.plugin.app_invocation.load_annotation_reply_config",
            return_value=annotation_reply,
        )
        app = _app(app_model_config_id="config-1")

        result = self.service._get_app_model_config_dict(app)

        assert result is not None
        assert result["user_input_form"] == [{"name": "bar"}]
        assert result["annotation_reply"] == annotation_reply
        queried_session, queried_app_id = load_annotation_reply_config.call_args.args
        assert isinstance(queried_session, Session)
        assert queried_app_id == "app-1"

    def test_get_app_model_config_dict_rejects_config_from_another_app(self) -> None:
        app_model_config = AppModelConfig(app_id="other-app", user_input_form=json.dumps([{"name": "bar"}]))
        app_model_config.id = "config-1"
        self.session.add(app_model_config)
        self.session.commit()
        app = _app(app_model_config_id=app_model_config.id)

        assert self.service._get_app_model_config_dict(app) is None
