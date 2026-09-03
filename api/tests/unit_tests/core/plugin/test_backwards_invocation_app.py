import json
from typing import cast

import pytest
from pydantic import BaseModel
from pytest_mock import MockerFixture
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.plugin.backwards_invocation.app import PluginAppBackwardsInvocation
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from models import Account, Tenant, TenantAccountJoin
from models.enums import EndUserType
from models.model import App, AppMode, AppModelConfig, EndUser
from models.workflow import Workflow, WorkflowType


class _Chunk(BaseModel):
    value: int


class _DatabaseWithEngine:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine


def _app(
    *,
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    mode: AppMode = AppMode.WORKFLOW,
    workflow_id: str | None = None,
    app_model_config_id: str | None = None,
) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Plugin app",
        description="",
        mode=mode,
        enable_site=False,
        enable_api=False,
        workflow_id=workflow_id,
        app_model_config_id=app_model_config_id,
    )


def _workflow(*, workflow_id: str = "workflow-1", app_id: str = "app-1", tenant_id: str = "tenant-1") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        _features="{}",
        created_by="account-1",
    )


def _end_user(
    *,
    user_id: str = "user-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    session_id: str = "browser-session",
) -> EndUser:
    return EndUser(
        id=user_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=EndUserType.BROWSER,
        session_id=session_id,
        name="Browser user",
        is_anonymous=True,
    )


class TestBaseBackwardsInvocation:
    def test_convert_to_event_stream_with_generator_and_error(self):
        def _stream():
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

    def test_convert_to_event_stream_with_non_generator(self):
        chunks = list(BaseBackwardsInvocation.convert_to_event_stream({"ok": True}))
        payload = json.loads(chunks[0].decode())
        assert payload["data"] == {"ok": True}
        assert payload["error"] == ""


class TestPluginAppBackwardsInvocation:
    @pytest.fixture(autouse=True)
    def _real_sessions(
        self,
        mocker: MockerFixture,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_engine: Engine,
    ) -> None:
        self.session = sqlite_session
        self.session_factory = sqlite_session_factory
        self.sqlite_engine = sqlite_engine
        mocker.patch("core.plugin.backwards_invocation.app.create_session", side_effect=sqlite_session_factory)

    def test_fetch_app_info_workflow_path(self, mocker: MockerFixture):
        variable = {"type": "text-input", "variable": "foo", "label": "Foo", "required": False}
        workflow = _workflow()
        workflow.features = json.dumps({"feature": "v"})
        workflow.graph = json.dumps({"nodes": [{"data": {"type": "start", "variables": [variable]}}]})
        app = _app(mode=AppMode.WORKFLOW)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=workflow)
        mapper = mocker.patch(
            "core.plugin.backwards_invocation.app.get_parameters_from_feature_dict",
            return_value={"mapped": True},
        )

        result = PluginAppBackwardsInvocation.fetch_app_info("app-1", "tenant-1")

        assert result == {"data": {"mapped": True}}
        mapper.assert_called_once_with(features_dict={"feature": "v"}, user_input_form=[{"text-input": variable}])

    def test_fetch_app_info_model_config_path(self, mocker: MockerFixture):
        model_config_dict = {"user_input_form": [{"name": "bar"}], "k": "v"}
        app = _app(mode=AppMode.COMPLETION)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app_model_config_dict", return_value=model_config_dict)
        mocker.patch(
            "core.plugin.backwards_invocation.app.get_parameters_from_feature_dict",
            return_value={"mapped": True},
        )

        result = PluginAppBackwardsInvocation.fetch_app_info("app-1", "tenant-1")

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
    def test_invoke_app_routes_by_mode(self, mocker: MockerFixture, mode, route_method):
        app = _app(mode=mode)
        user = _end_user()
        workflow = _workflow()
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=user)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=workflow)
        route = mocker.patch.object(PluginAppBackwardsInvocation, route_method, return_value={"routed": True})

        result = PluginAppBackwardsInvocation.invoke_app(
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

    def test_invoke_app_uses_end_user_when_user_id_missing(self, mocker: MockerFixture):
        app = _app(mode=AppMode.WORKFLOW)
        end_user = _end_user()
        workflow = _workflow()
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=workflow)
        get_or_create = mocker.patch(
            "core.plugin.backwards_invocation.app.EndUserService.get_or_create_end_user",
            return_value=end_user,
        )
        route = mocker.patch.object(PluginAppBackwardsInvocation, "invoke_workflow_app", return_value={"ok": True})

        result = PluginAppBackwardsInvocation.invoke_app(
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
        get_or_create.assert_called_once_with(app)
        assert route.call_args.args[1] is workflow
        assert route.call_args.args[2] is end_user

    def test_invoke_app_missing_query_for_chat_raises(self, mocker: MockerFixture):
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=_app(mode=AppMode.CHAT))
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=_end_user())

        with pytest.raises(ValueError, match="missing query"):
            PluginAppBackwardsInvocation.invoke_app(
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

    def test_invoke_app_unexpected_mode_raises(self, mocker: MockerFixture):
        mocker.patch.object(
            PluginAppBackwardsInvocation,
            "_get_app",
            return_value=_app(mode=cast(AppMode, "other")),
        )
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=_end_user())

        with pytest.raises(ValueError, match="unexpected app type"):
            PluginAppBackwardsInvocation.invoke_app(
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
        ("mode", "generator_path"),
        [
            (AppMode.AGENT_CHAT, "core.plugin.backwards_invocation.app.AgentChatAppGenerator.generate"),
            (AppMode.CHAT, "core.plugin.backwards_invocation.app.ChatAppGenerator.generate"),
        ],
    )
    def test_invoke_chat_app_agent_and_chat(self, mocker: MockerFixture, mode, generator_path):
        app = _app(mode=mode)
        spy = mocker.patch(generator_path, return_value={"result": "ok"})

        result = PluginAppBackwardsInvocation.invoke_chat_app(
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
        assert spy.call_count == 1

    def test_invoke_chat_app_advanced_chat_injects_pause_state_config(self, mocker: MockerFixture):
        workflow = _workflow()
        workflow.created_by = "owner-id"

        app = _app(mode=AppMode.ADVANCED_CHAT)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=workflow)

        mocker.patch(
            "core.plugin.backwards_invocation.app.db",
            _DatabaseWithEngine(self.sqlite_engine),
        )
        generator_spy = mocker.patch(
            "core.plugin.backwards_invocation.app.AdvancedChatAppGenerator.generate",
            return_value={"result": "ok"},
        )
        session = self.session

        result = PluginAppBackwardsInvocation.invoke_chat_app(
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
        call_kwargs = generator_spy.call_args.kwargs
        assert call_kwargs["session"] is session
        pause_state_config = call_kwargs.get("pause_state_config")
        assert isinstance(pause_state_config, PauseStateLayerConfig)
        assert pause_state_config.state_owner_user_id == "owner-id"

    def test_invoke_chat_app_advanced_chat_without_workflow_raises(self, mocker: MockerFixture):
        app = _app(mode=AppMode.ADVANCED_CHAT)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=None)
        with pytest.raises(ValueError, match="unexpected app type"):
            PluginAppBackwardsInvocation.invoke_chat_app(
                app=app,
                user=_end_user(),
                conversation_id="conv-1",
                query="hello",
                stream=False,
                inputs={},
                files=[],
                session=self.session,
            )

    def test_invoke_chat_app_unexpected_mode_raises(self):
        app = _app(mode=cast(AppMode, "invalid"))
        with pytest.raises(ValueError, match="unexpected app type"):
            PluginAppBackwardsInvocation.invoke_chat_app(
                app=app,
                user=_end_user(),
                conversation_id="conv-1",
                query="hello",
                stream=False,
                inputs={},
                files=[],
                session=self.session,
            )

    def test_invoke_workflow_app_injects_pause_state_config(self, mocker: MockerFixture):
        workflow = _workflow()
        workflow.created_by = "owner-id"

        app = _app(mode=AppMode.WORKFLOW)

        mocker.patch(
            "core.plugin.backwards_invocation.app.db",
            _DatabaseWithEngine(self.sqlite_engine),
        )
        generator_spy = mocker.patch(
            "core.plugin.backwards_invocation.app.WorkflowAppGenerator.generate",
            return_value={"result": "ok"},
        )

        result = PluginAppBackwardsInvocation.invoke_workflow_app(
            app=app,
            workflow=workflow,
            user=_end_user(),
            stream=False,
            inputs={"k": "v"},
            files=[],
        )

        assert result == {"result": "ok"}
        call_kwargs = generator_spy.call_args.kwargs
        pause_state_config = call_kwargs.get("pause_state_config")
        assert isinstance(pause_state_config, PauseStateLayerConfig)
        assert pause_state_config.state_owner_user_id == "owner-id"

    def test_invoke_app_workflow_without_workflow_raises(self, mocker: MockerFixture):
        app = _app(mode=AppMode.WORKFLOW)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=_end_user())
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=None)
        with pytest.raises(ValueError, match="unexpected app type"):
            PluginAppBackwardsInvocation.invoke_app(
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

    def test_invoke_completion_app(self, mocker: MockerFixture):
        spy = mocker.patch(
            "core.plugin.backwards_invocation.app.CompletionAppGenerator.generate", return_value={"ok": 1}
        )
        app = _app(mode=AppMode.COMPLETION)

        result = PluginAppBackwardsInvocation.invoke_completion_app(app, _end_user(), False, {"x": 1}, [], self.session)

        assert result == {"ok": 1}
        assert spy.call_count == 1

    def test_get_user_returns_end_user(self):
        app = _app()
        end_user = EndUser(
            id="uid",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="browser-session",
            name="Browser user",
            is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        user = PluginAppBackwardsInvocation._get_user("uid", app)

        assert user.id == "uid"
        assert user.tenant_id == app.tenant_id
        assert user.app_id == app.id

    def test_get_user_returns_end_user_by_session_id(self):
        app = _app()
        end_user = EndUser(
            id="session-user",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="wecom-sender-1",
            name="External user",
            is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        user = PluginAppBackwardsInvocation._get_user("wecom-sender-1", app)

        assert user.id == "session-user"

    def test_get_user_rejects_end_user_from_another_app(self):
        app = _app()
        end_user = EndUser(
            id="uid",
            tenant_id=app.tenant_id,
            app_id="other-app",
            type=EndUserType.BROWSER,
            session_id="browser-session",
            name="Browser user",
            is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            PluginAppBackwardsInvocation._get_user("uid", app)

    def test_get_user_rejects_nonmatching_session_id(self):
        app = _app()
        end_user = EndUser(
            id="session-user",
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="other-session",
            name="External user",
            is_anonymous=True,
        )
        self.session.add(end_user)
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            PluginAppBackwardsInvocation._get_user("wecom-sender-1", app)

    def test_get_user_falls_back_to_account_user(self):
        app = _app()
        tenant = Tenant(name="Plugin tenant")
        tenant.id = app.tenant_id
        account = Account(name="Account user", email="account-user@example.com")
        account.id = "account-user"
        membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id)
        self.session.add_all([tenant, account, membership])
        self.session.commit()

        user = PluginAppBackwardsInvocation._get_user(account.id, app)

        assert user.id == "account-user"

    def test_get_user_rejects_account_from_another_tenant(self):
        app = _app()
        tenant = Tenant(name="Plugin tenant")
        tenant.id = "other-tenant"
        account = Account(name="Account user", email="account-user@example.com")
        account.id = "account-user"
        membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id)
        self.session.add_all([tenant, account, membership])
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            PluginAppBackwardsInvocation._get_user(account.id, app)

    def test_get_user_raises_when_user_not_found(self):
        app = _app()
        other_tenant_user = EndUser(
            id="uid",
            tenant_id="other-tenant",
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id="uid",
            name="Wrong tenant",
            is_anonymous=True,
        )
        self.session.add(other_tenant_user)
        self.session.commit()

        with pytest.raises(ValueError, match="user not found"):
            PluginAppBackwardsInvocation._get_user("uid", app)

    def test_invoke_app_creates_end_user_for_unknown_external_user_id(self, mocker: MockerFixture):
        app = _app(mode=AppMode.WORKFLOW)
        end_user = _end_user(session_id="wecom-sender-1")
        workflow = _workflow()
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=workflow)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", side_effect=ValueError("user not found"))
        get_or_create = mocker.patch(
            "core.plugin.backwards_invocation.app.EndUserService.get_or_create_end_user",
            return_value=end_user,
        )
        route = mocker.patch.object(PluginAppBackwardsInvocation, "invoke_workflow_app", return_value={"ok": True})

        result = PluginAppBackwardsInvocation.invoke_app(
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
        get_or_create.assert_called_once_with(app, user_id="wecom-sender-1")
        assert route.call_args.args[2] is end_user

    def test_get_app_returns_app(self):
        app_obj = _app(app_id="app", tenant_id="tenant")
        self.session.add(app_obj)
        self.session.commit()

        result = PluginAppBackwardsInvocation._get_app("app", "tenant")
        assert result.id == app_obj.id
        assert result.tenant_id == app_obj.tenant_id

    def test_get_app_raises_when_missing(self):
        self.session.add(_app(app_id="app", tenant_id="other-tenant"))
        self.session.commit()

        with pytest.raises(ValueError, match="app not found"):
            PluginAppBackwardsInvocation._get_app("app", "tenant")

    def test_get_app_raises_when_query_fails(self):
        def fail_query(*_args, **_kwargs):
            raise RuntimeError("db down")

        event.listen(self.sqlite_engine, "before_cursor_execute", fail_query, once=True)

        with pytest.raises(ValueError, match="app not found"):
            PluginAppBackwardsInvocation._get_app("app", "tenant")

    def test_get_workflow_stays_inside_app_boundary(self):
        workflow = _workflow()
        other_workflow = _workflow(workflow_id="workflow-other", tenant_id="other-tenant")
        self.session.add_all([workflow, other_workflow])
        self.session.commit()
        app = _app(workflow_id="workflow-1")

        result = PluginAppBackwardsInvocation._get_workflow(app)
        assert result is not None
        assert result.id == workflow.id
        assert result.tenant_id == app.tenant_id

    def test_get_workflow_rejects_workflow_from_another_tenant(self):
        workflow = _workflow(tenant_id="other-tenant")
        self.session.add(workflow)
        self.session.commit()
        app = _app(app_id=workflow.app_id, tenant_id="tenant-1", workflow_id=workflow.id)

        assert PluginAppBackwardsInvocation._get_workflow(app) is None

    def test_get_workflow_rejects_workflow_from_another_app(self):
        workflow = _workflow(app_id="other-app")
        self.session.add(workflow)
        self.session.commit()
        app = _app(app_id="app-1", tenant_id=workflow.tenant_id, workflow_id=workflow.id)

        assert PluginAppBackwardsInvocation._get_workflow(app) is None

    def test_get_app_model_config_dict_uses_explicit_session_for_annotation_reply(self, mocker: MockerFixture):
        annotation_reply = {"enabled": False}
        app_model_config = AppModelConfig(app_id="app-1", user_input_form=json.dumps([{"name": "bar"}]))
        app_model_config.id = "config-1"
        self.session.add(app_model_config)
        self.session.commit()
        load_annotation_reply_config = mocker.patch(
            "core.plugin.backwards_invocation.app.load_annotation_reply_config",
            return_value=annotation_reply,
        )
        app = _app(app_model_config_id="config-1")

        result = PluginAppBackwardsInvocation._get_app_model_config_dict(app)

        assert result is not None
        assert result["user_input_form"] == [{"name": "bar"}]
        assert result["annotation_reply"] == annotation_reply
        queried_session, queried_app_id = load_annotation_reply_config.call_args.args
        assert isinstance(queried_session, Session)
        assert queried_app_id == "app-1"

    def test_get_app_model_config_dict_rejects_config_from_another_app(self):
        app_model_config = AppModelConfig(app_id="other-app", user_input_form=json.dumps([{"name": "bar"}]))
        app_model_config.id = "config-1"
        self.session.add(app_model_config)
        self.session.commit()
        app = _app(app_model_config_id=app_model_config.id)

        assert PluginAppBackwardsInvocation._get_app_model_config_dict(app) is None
