import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel
from pytest_mock import MockerFixture
from sqlalchemy.dialects import postgresql

from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.plugin.backwards_invocation.app import PluginAppBackwardsInvocation
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from models.model import AppMode


class _Chunk(BaseModel):
    value: int


def _build_app_model_config(result: dict | None = None):
    app_model_config = MagicMock()
    app_model_config.app_id = "app-1"
    app_model_config.to_dict.return_value = result or {
        "user_input_form": [{"name": "bar"}],
        "annotation_reply": {"enabled": False},
    }
    return app_model_config


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
    def patch_create_session(self, mocker: MockerFixture, *, return_value=None, side_effect=None):
        session = MagicMock()
        if side_effect is not None:
            session.scalar.side_effect = side_effect
        else:
            session.scalar.return_value = return_value
        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = None
        mocker.patch("core.plugin.backwards_invocation.app.create_session", return_value=session_ctx)
        return session

    def test_fetch_app_info_workflow_path(self, mocker: MockerFixture):
        workflow = MagicMock()
        workflow.features_dict = {"feature": "v"}
        workflow.user_input_form.return_value = [{"name": "foo"}]
        app = MagicMock(mode=AppMode.WORKFLOW)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=workflow)
        mapper = mocker.patch(
            "core.plugin.backwards_invocation.app.get_parameters_from_feature_dict",
            return_value={"mapped": True},
        )

        result = PluginAppBackwardsInvocation.fetch_app_info("app-1", "tenant-1")

        assert result == {"data": {"mapped": True}}
        mapper.assert_called_once_with(features_dict={"feature": "v"}, user_input_form=[{"name": "foo"}])

    def test_fetch_app_info_model_config_path(self, mocker: MockerFixture):
        model_config_dict = {"user_input_form": [{"name": "bar"}], "k": "v"}
        app = MagicMock(mode=AppMode.COMPLETION)
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
        app = MagicMock(mode=mode)
        user = MagicMock()
        workflow = MagicMock()
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
        )

        assert result == {"routed": True}
        assert route.call_count == 1

    def test_invoke_app_uses_end_user_when_user_id_missing(self, mocker: MockerFixture):
        app = MagicMock(mode=AppMode.WORKFLOW)
        end_user = MagicMock()
        workflow = MagicMock()
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
        )

        assert result == {"ok": True}
        get_or_create.assert_called_once_with(app)
        assert route.call_args.args[1] is workflow
        assert route.call_args.args[2] is end_user

    def test_invoke_app_missing_query_for_chat_raises(self, mocker: MockerFixture):
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=MagicMock(mode=AppMode.CHAT))
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=MagicMock())

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
            )

    def test_invoke_app_unexpected_mode_raises(self, mocker: MockerFixture):
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=MagicMock(mode="other"))
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=MagicMock())

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
            )

    @pytest.mark.parametrize(
        ("mode", "generator_path"),
        [
            (AppMode.AGENT_CHAT, "core.plugin.backwards_invocation.app.AgentChatAppGenerator.generate"),
            (AppMode.CHAT, "core.plugin.backwards_invocation.app.ChatAppGenerator.generate"),
        ],
    )
    def test_invoke_chat_app_agent_and_chat(self, mocker: MockerFixture, mode, generator_path):
        app = MagicMock(mode=mode, workflow=None)
        spy = mocker.patch(generator_path, return_value={"result": "ok"})

        result = PluginAppBackwardsInvocation.invoke_chat_app(
            app=app,
            user=MagicMock(),
            conversation_id="conv-1",
            query="hello",
            stream=False,
            inputs={"k": "v"},
            files=[],
        )

        assert result == {"result": "ok"}
        assert spy.call_count == 1

    def test_invoke_chat_app_advanced_chat_injects_pause_state_config(self, mocker: MockerFixture):
        workflow = MagicMock()
        workflow.created_by = "owner-id"

        app = MagicMock()
        app.mode = AppMode.ADVANCED_CHAT
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=workflow)

        mocker.patch(
            "core.plugin.backwards_invocation.app.db",
            SimpleNamespace(engine=MagicMock()),
        )
        generator_spy = mocker.patch(
            "core.plugin.backwards_invocation.app.AdvancedChatAppGenerator.generate",
            return_value={"result": "ok"},
        )

        result = PluginAppBackwardsInvocation.invoke_chat_app(
            app=app,
            user=MagicMock(),
            conversation_id="conv-1",
            query="hello",
            stream=False,
            inputs={"k": "v"},
            files=[],
        )

        assert result == {"result": "ok"}
        call_kwargs = generator_spy.call_args.kwargs
        pause_state_config = call_kwargs.get("pause_state_config")
        assert isinstance(pause_state_config, PauseStateLayerConfig)
        assert pause_state_config.state_owner_user_id == "owner-id"

    def test_invoke_chat_app_advanced_chat_without_workflow_raises(self, mocker: MockerFixture):
        app = MagicMock(mode=AppMode.ADVANCED_CHAT)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_workflow", return_value=None)
        with pytest.raises(ValueError, match="unexpected app type"):
            PluginAppBackwardsInvocation.invoke_chat_app(
                app=app,
                user=MagicMock(),
                conversation_id="conv-1",
                query="hello",
                stream=False,
                inputs={},
                files=[],
            )

    def test_invoke_chat_app_unexpected_mode_raises(self):
        app = MagicMock(mode="invalid")
        with pytest.raises(ValueError, match="unexpected app type"):
            PluginAppBackwardsInvocation.invoke_chat_app(
                app=app,
                user=MagicMock(),
                conversation_id="conv-1",
                query="hello",
                stream=False,
                inputs={},
                files=[],
            )

    def test_invoke_workflow_app_injects_pause_state_config(self, mocker: MockerFixture):
        workflow = MagicMock()
        workflow.created_by = "owner-id"

        app = MagicMock()
        app.mode = AppMode.WORKFLOW

        mocker.patch(
            "core.plugin.backwards_invocation.app.db",
            SimpleNamespace(engine=MagicMock()),
        )
        generator_spy = mocker.patch(
            "core.plugin.backwards_invocation.app.WorkflowAppGenerator.generate",
            return_value={"result": "ok"},
        )

        result = PluginAppBackwardsInvocation.invoke_workflow_app(
            app=app,
            workflow=workflow,
            user=MagicMock(),
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
        app = MagicMock(mode=AppMode.WORKFLOW)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=MagicMock())
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
            )

    def test_invoke_completion_app(self, mocker: MockerFixture):
        spy = mocker.patch(
            "core.plugin.backwards_invocation.app.CompletionAppGenerator.generate", return_value={"ok": 1}
        )
        app = MagicMock(mode=AppMode.COMPLETION)

        result = PluginAppBackwardsInvocation.invoke_completion_app(app, MagicMock(), False, {"x": 1}, [])

        assert result == {"ok": 1}
        assert spy.call_count == 1

    def test_get_user_returns_end_user(self, mocker: MockerFixture):
        session = self.patch_create_session(mocker, side_effect=[MagicMock(id="end-user")])
        app = SimpleNamespace(id="app-1", tenant_id="tenant-1")

        user = PluginAppBackwardsInvocation._get_user("uid", app)

        assert user.id == "end-user"
        stmt = session.scalar.call_args_list[0].args[0]
        compiled = str(stmt.compile(dialect=postgresql.dialect()))
        assert "end_users.id" in compiled
        assert "end_users.tenant_id" in compiled
        assert "end_users.app_id" in compiled
        assert stmt.compile().params == {"id_1": "uid", "tenant_id_1": "tenant-1", "app_id_1": "app-1"}

    def test_get_user_falls_back_to_account_user(self, mocker: MockerFixture):
        session = self.patch_create_session(mocker, side_effect=[None, MagicMock(id="account-user")])
        app = SimpleNamespace(id="app-1", tenant_id="tenant-1")

        user = PluginAppBackwardsInvocation._get_user("uid", app)

        assert user.id == "account-user"
        stmt = session.scalar.call_args_list[1].args[0]
        compiled = str(stmt.compile(dialect=postgresql.dialect()))
        assert "accounts.id" in compiled
        assert "tenant_account_joins.account_id" in compiled
        assert "tenant_account_joins.tenant_id" in compiled
        assert stmt.compile().params == {"id_1": "uid", "tenant_id_1": "tenant-1"}

    def test_get_user_raises_when_user_not_found(self, mocker: MockerFixture):
        self.patch_create_session(mocker, side_effect=[None, None])
        app = SimpleNamespace(id="app-1", tenant_id="tenant-1")

        with pytest.raises(ValueError, match="user not found"):
            PluginAppBackwardsInvocation._get_user("uid", app)

    def test_get_app_returns_app(self, mocker: MockerFixture):
        app_obj = MagicMock(id="app")
        self.patch_create_session(mocker, return_value=app_obj)

        assert PluginAppBackwardsInvocation._get_app("app", "tenant") is app_obj

    def test_get_app_raises_when_missing(self, mocker: MockerFixture):
        self.patch_create_session(mocker, return_value=None)

        with pytest.raises(ValueError, match="app not found"):
            PluginAppBackwardsInvocation._get_app("app", "tenant")

    def test_get_app_raises_when_query_fails(self, mocker: MockerFixture):
        self.patch_create_session(mocker, side_effect=RuntimeError("db down"))

        with pytest.raises(ValueError, match="app not found"):
            PluginAppBackwardsInvocation._get_app("app", "tenant")

    def test_get_workflow_stays_inside_app_boundary(self, mocker: MockerFixture):
        workflow = MagicMock(id="workflow")
        session = self.patch_create_session(mocker, return_value=workflow)
        app = SimpleNamespace(id="app-1", tenant_id="tenant-1", workflow_id="workflow-1")

        assert PluginAppBackwardsInvocation._get_workflow(app) is workflow

        stmt = session.scalar.call_args.args[0]
        compiled = str(stmt.compile(dialect=postgresql.dialect()))
        assert "workflows.id" in compiled
        assert "workflows.tenant_id" in compiled
        assert "workflows.app_id" in compiled
        assert stmt.compile().params == {
            "id_1": "workflow-1",
            "tenant_id_1": "tenant-1",
            "app_id_1": "app-1",
            "param_1": 1,
        }

    def test_get_app_model_config_dict_uses_explicit_session_for_annotation_reply(self, mocker: MockerFixture):
        annotation_reply = {"enabled": False}
        app_model_config = _build_app_model_config()
        session = self.patch_create_session(mocker, return_value=app_model_config)
        load_annotation_reply_config = mocker.patch(
            "core.plugin.backwards_invocation.app.load_annotation_reply_config",
            return_value=annotation_reply,
        )
        app = SimpleNamespace(id="app-1", app_model_config_id="config-1")

        result = PluginAppBackwardsInvocation._get_app_model_config_dict(app)

        assert result is not None
        assert result["user_input_form"] == [{"name": "bar"}]
        assert result["annotation_reply"] == annotation_reply
        load_annotation_reply_config.assert_called_once_with(session, "app-1")
        app_model_config.to_dict.assert_called_once_with(annotation_reply=annotation_reply)

        stmt = session.scalar.call_args.args[0]
        compiled = str(stmt.compile(dialect=postgresql.dialect()))
        assert "app_model_configs.id" in compiled
        assert "app_model_configs.app_id" in compiled
        assert stmt.compile().params == {"id_1": "config-1", "app_id_1": "app-1", "param_1": 1}
