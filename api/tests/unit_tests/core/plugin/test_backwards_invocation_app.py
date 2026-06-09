import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel
from pytest_mock import MockerFixture

from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.plugin.backwards_invocation.app import PluginAppBackwardsInvocation
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from models.model import AppMode


class _Chunk(BaseModel):
    value: int


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
    def test_fetch_app_info_workflow_path(self, mocker: MockerFixture):
        workflow = MagicMock()
        workflow.features_dict = {"feature": "v"}
        workflow.user_input_form.return_value = [{"name": "foo"}]
        app = MagicMock(mode=AppMode.WORKFLOW, workflow=workflow)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mapper = mocker.patch(
            "core.plugin.backwards_invocation.app.get_parameters_from_feature_dict",
            return_value={"mapped": True},
        )

        result = PluginAppBackwardsInvocation.fetch_app_info("app-1", "tenant-1")

        assert result == {"data": {"mapped": True}}
        mapper.assert_called_once_with(features_dict={"feature": "v"}, user_input_form=[{"name": "foo"}])

    def test_fetch_app_info_model_config_path(self, mocker: MockerFixture):
        model_config = MagicMock()
        model_config.to_dict.return_value = {"user_input_form": [{"name": "bar"}], "k": "v"}
        app = MagicMock(mode=AppMode.COMPLETION, app_model_config=model_config)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
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
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_user", return_value=user)
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
        mocker.patch.object(PluginAppBackwardsInvocation, "_get_app", return_value=app)
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
        assert route.call_args.args[1] is end_user

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
        app.workflow = workflow

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

    def test_invoke_chat_app_advanced_chat_without_workflow_raises(self):
        app = MagicMock(mode=AppMode.ADVANCED_CHAT, workflow=None)
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
        app.workflow = workflow

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

    def test_invoke_workflow_app_without_workflow_raises(self):
        app = MagicMock(mode=AppMode.WORKFLOW, workflow=None)
        with pytest.raises(ValueError, match="unexpected app type"):
            PluginAppBackwardsInvocation.invoke_workflow_app(
                app=app,
                user=MagicMock(),
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
        session = MagicMock()
        session.scalar.side_effect = [MagicMock(id="end-user")]
        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = None
        mocker.patch("core.plugin.backwards_invocation.app.Session", return_value=session_ctx)
        mocker.patch("core.plugin.backwards_invocation.app.db", SimpleNamespace(engine=MagicMock()))

        user = PluginAppBackwardsInvocation._get_user("uid")
        assert user.id == "end-user"

    def test_get_user_falls_back_to_account_user(self, mocker: MockerFixture):
        session = MagicMock()
        session.scalar.side_effect = [None, MagicMock(id="account-user")]
        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = None
        mocker.patch("core.plugin.backwards_invocation.app.Session", return_value=session_ctx)
        mocker.patch("core.plugin.backwards_invocation.app.db", SimpleNamespace(engine=MagicMock()))

        user = PluginAppBackwardsInvocation._get_user("uid")
        assert user.id == "account-user"

    def test_get_user_raises_when_user_not_found(self, mocker: MockerFixture):
        session = MagicMock()
        session.scalar.side_effect = [None, None]
        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = None
        mocker.patch("core.plugin.backwards_invocation.app.Session", return_value=session_ctx)
        mocker.patch("core.plugin.backwards_invocation.app.db", SimpleNamespace(engine=MagicMock()))

        with pytest.raises(ValueError, match="user not found"):
            PluginAppBackwardsInvocation._get_user("uid")

    def test_get_app_returns_app(self, mocker: MockerFixture):
        app_obj = MagicMock(id="app")
        db = SimpleNamespace(session=MagicMock(scalar=MagicMock(return_value=app_obj)))
        mocker.patch("core.plugin.backwards_invocation.app.db", db)

        assert PluginAppBackwardsInvocation._get_app("app", "tenant") is app_obj

    def test_get_app_raises_when_missing(self, mocker: MockerFixture):
        db = SimpleNamespace(session=MagicMock(scalar=MagicMock(return_value=None)))
        mocker.patch("core.plugin.backwards_invocation.app.db", db)

        with pytest.raises(ValueError, match="app not found"):
            PluginAppBackwardsInvocation._get_app("app", "tenant")

    def test_get_app_raises_when_query_fails(self, mocker: MockerFixture):
        db = SimpleNamespace(session=MagicMock(scalar=MagicMock(side_effect=RuntimeError("db down"))))
        mocker.patch("core.plugin.backwards_invocation.app.db", db)

        with pytest.raises(ValueError, match="app not found"):
            PluginAppBackwardsInvocation._get_app("app", "tenant")
