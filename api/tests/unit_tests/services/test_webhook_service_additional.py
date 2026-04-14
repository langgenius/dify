from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from flask import Flask
from graphon.variables.types import SegmentType
from werkzeug.exceptions import RequestEntityTooLarge

from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)
from models.enums import AppTriggerStatus
from models.model import App
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from services.errors.app import QuotaExceededError
from services.trigger import webhook_service as service_module
from services.trigger.webhook_service import WebhookService


class _FakeQuery:
    def __init__(self, result: Any) -> None:
        self._result = result

    def where(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self

    def filter(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self

    def order_by(self, *args: Any, **kwargs: Any) -> "_FakeQuery":
        return self

    def first(self) -> Any:
        return self._result


class _SessionContext:
    def __init__(self, session: Any) -> None:
        self._session = session

    def __enter__(self) -> Any:
        return self._session

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


class _SessionmakerContext:
    def __init__(self, session: Any) -> None:
        self._session = session

    def begin(self) -> "_SessionmakerContext":
        return self

    def __enter__(self) -> Any:
        return self._session

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


@pytest.fixture
def flask_app() -> Flask:
    return Flask(__name__)


def _patch_session(monkeypatch: pytest.MonkeyPatch, session: Any) -> None:
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=MagicMock(), session=MagicMock()))
    monkeypatch.setattr(service_module, "Session", lambda *args, **kwargs: _SessionContext(session))
    monkeypatch.setattr(service_module, "sessionmaker", lambda *args, **kwargs: _SessionmakerContext(session))


def _workflow_trigger(**kwargs: Any) -> WorkflowWebhookTrigger:
    return cast(WorkflowWebhookTrigger, SimpleNamespace(**kwargs))


def _workflow(**kwargs: Any) -> Workflow:
    return cast(Workflow, SimpleNamespace(**kwargs))


def _app(**kwargs: Any) -> App:
    return cast(App, SimpleNamespace(**kwargs))


class TestWebhookServiceLookup:
    def test_get_webhook_trigger_and_workflow_should_raise_when_webhook_not_found(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        fake_session = MagicMock()
        fake_session.scalar.return_value = None
        _patch_session(monkeypatch, fake_session)

        with pytest.raises(ValueError, match="Webhook not found"):
            WebhookService.get_webhook_trigger_and_workflow("webhook-1")

    def test_get_webhook_trigger_and_workflow_should_raise_when_app_trigger_not_found(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
        fake_session = MagicMock()
        fake_session.scalar.side_effect = [webhook_trigger, None]
        _patch_session(monkeypatch, fake_session)

        with pytest.raises(ValueError, match="App trigger not found"):
            WebhookService.get_webhook_trigger_and_workflow("webhook-1")

    def test_get_webhook_trigger_and_workflow_should_raise_when_app_trigger_rate_limited(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
        app_trigger = SimpleNamespace(status=AppTriggerStatus.RATE_LIMITED)
        fake_session = MagicMock()
        fake_session.scalar.side_effect = [webhook_trigger, app_trigger]
        _patch_session(monkeypatch, fake_session)

        with pytest.raises(ValueError, match="rate limited"):
            WebhookService.get_webhook_trigger_and_workflow("webhook-1")

    def test_get_webhook_trigger_and_workflow_should_raise_when_app_trigger_disabled(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
        app_trigger = SimpleNamespace(status=AppTriggerStatus.DISABLED)
        fake_session = MagicMock()
        fake_session.scalar.side_effect = [webhook_trigger, app_trigger]
        _patch_session(monkeypatch, fake_session)

        with pytest.raises(ValueError, match="disabled"):
            WebhookService.get_webhook_trigger_and_workflow("webhook-1")

    def test_get_webhook_trigger_and_workflow_should_raise_when_workflow_not_found(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
        app_trigger = SimpleNamespace(status=AppTriggerStatus.ENABLED)
        fake_session = MagicMock()
        fake_session.scalar.side_effect = [webhook_trigger, app_trigger, None]
        _patch_session(monkeypatch, fake_session)

        with pytest.raises(ValueError, match="Workflow not found"):
            WebhookService.get_webhook_trigger_and_workflow("webhook-1")

    def test_get_webhook_trigger_and_workflow_should_return_values_for_non_debug_mode(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
        app_trigger = SimpleNamespace(status=AppTriggerStatus.ENABLED)
        workflow = MagicMock()
        workflow.get_node_config_by_id.return_value = {"data": {"key": "value"}}

        fake_session = MagicMock()
        fake_session.scalar.side_effect = [webhook_trigger, app_trigger, workflow]
        _patch_session(monkeypatch, fake_session)

        got_trigger, got_workflow, got_node_config = WebhookService.get_webhook_trigger_and_workflow("webhook-1")

        assert got_trigger is webhook_trigger
        assert got_workflow is workflow
        assert got_node_config == {"data": {"key": "value"}}

    def test_get_webhook_trigger_and_workflow_should_return_values_for_debug_mode(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = SimpleNamespace(app_id="app-1", node_id="node-1")
        workflow = MagicMock()
        workflow.get_node_config_by_id.return_value = {"data": {"mode": "debug"}}

        fake_session = MagicMock()
        fake_session.scalar.side_effect = [webhook_trigger, workflow]
        _patch_session(monkeypatch, fake_session)

        got_trigger, got_workflow, got_node_config = WebhookService.get_webhook_trigger_and_workflow(
            "webhook-1",
            is_debug=True,
        )

        assert got_trigger is webhook_trigger
        assert got_workflow is workflow
        assert got_node_config == {"data": {"mode": "debug"}}


class TestWebhookServiceExtractionFallbacks:
    def test_extract_webhook_data_should_use_text_fallback_for_unknown_content_type(
        self,
        flask_app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        warning_mock = MagicMock()
        monkeypatch.setattr(service_module.logger, "warning", warning_mock)
        webhook_trigger = MagicMock()

        with flask_app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/vnd.custom"},
            data="plain content",
        ):
            result = WebhookService.extract_webhook_data(webhook_trigger)

        assert result["body"] == {"raw": "plain content"}
        warning_mock.assert_called_once()

    def test_extract_webhook_data_should_raise_for_request_too_large(
        self,
        flask_app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(service_module.dify_config, "WEBHOOK_REQUEST_BODY_MAX_SIZE", 1)

        with flask_app.test_request_context("/webhook", method="POST", data="ab"):
            with pytest.raises(RequestEntityTooLarge):
                WebhookService.extract_webhook_data(MagicMock())

    def test_extract_octet_stream_body_should_return_none_when_empty_payload(self, flask_app: Flask) -> None:
        webhook_trigger = MagicMock()

        with flask_app.test_request_context("/webhook", method="POST", data=b""):
            body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

        assert body == {"raw": None}
        assert files == {}

    def test_extract_octet_stream_body_should_return_none_when_processing_raises(
        self,
        flask_app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = MagicMock()
        monkeypatch.setattr(
            WebhookService, "_detect_binary_mimetype", MagicMock(return_value="application/octet-stream")
        )
        monkeypatch.setattr(WebhookService, "_create_file_from_binary", MagicMock(side_effect=RuntimeError("boom")))

        with flask_app.test_request_context("/webhook", method="POST", data=b"abc"):
            body, files = WebhookService._extract_octet_stream_body(webhook_trigger)

        assert body == {"raw": None}
        assert files == {}

    def test_extract_text_body_should_return_empty_string_when_request_read_fails(
        self,
        flask_app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr("flask.wrappers.Request.get_data", MagicMock(side_effect=RuntimeError("read error")))

        with flask_app.test_request_context("/webhook", method="POST", data="abc"):
            body, files = WebhookService._extract_text_body()

        assert body == {"raw": ""}
        assert files == {}

    def test_detect_binary_mimetype_should_fallback_when_magic_raises(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        fake_magic = MagicMock()
        fake_magic.from_buffer.side_effect = RuntimeError("magic failed")
        monkeypatch.setattr(service_module, "magic", fake_magic)

        result = WebhookService._detect_binary_mimetype(b"binary")

        assert result == "application/octet-stream"

    def test_process_file_uploads_should_use_octet_stream_fallback_when_mimetype_unknown(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = _workflow_trigger(created_by="user-1", tenant_id="tenant-1")
        file_obj = MagicMock()
        file_obj.to_dict.return_value = {"id": "f-1"}
        monkeypatch.setattr(WebhookService, "_create_file_from_binary", MagicMock(return_value=file_obj))
        monkeypatch.setattr(service_module.mimetypes, "guess_type", MagicMock(return_value=(None, None)))

        uploaded = MagicMock()
        uploaded.filename = "file.unknown"
        uploaded.content_type = None
        uploaded.read.return_value = b"content"

        result = WebhookService._process_file_uploads({"f": uploaded}, webhook_trigger)

        assert result == {"f": {"id": "f-1"}}

    def test_create_file_from_binary_should_call_tool_file_manager_and_file_factory(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = _workflow_trigger(created_by="user-1", tenant_id="tenant-1")
        manager = MagicMock()
        manager.create_file_by_raw.return_value = SimpleNamespace(id="tool-file-1")
        monkeypatch.setattr(service_module, "ToolFileManager", MagicMock(return_value=manager))
        expected_file = MagicMock()
        monkeypatch.setattr(service_module.file_factory, "build_from_mapping", MagicMock(return_value=expected_file))

        result = WebhookService._create_file_from_binary(b"abc", "text/plain", webhook_trigger)

        assert result is expected_file
        manager.create_file_by_raw.assert_called_once()


class TestWebhookServiceValidationAndConversion:
    @pytest.mark.parametrize(
        ("raw_value", "param_type", "expected"),
        [
            ("42", SegmentType.NUMBER, 42),
            ("3.14", SegmentType.NUMBER, 3.14),
            ("yes", SegmentType.BOOLEAN, True),
            ("no", SegmentType.BOOLEAN, False),
        ],
    )
    def test_convert_form_value_should_convert_supported_types(
        self,
        raw_value: str,
        param_type: str,
        expected: Any,
    ) -> None:
        result = WebhookService._convert_form_value("param", raw_value, param_type)
        assert result == expected

    def test_convert_form_value_should_raise_for_unsupported_type(self) -> None:
        with pytest.raises(ValueError, match="Unsupported type"):
            WebhookService._convert_form_value("p", "x", SegmentType.FILE)

    def test_validate_json_value_should_return_original_for_unmapped_supported_segment_type(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        warning_mock = MagicMock()
        monkeypatch.setattr(service_module.logger, "warning", warning_mock)

        result = WebhookService._validate_json_value("param", {"x": 1}, "unsupported-type")

        assert result == {"x": 1}
        warning_mock.assert_called_once()

    def test_validate_and_convert_value_should_wrap_conversion_errors(self) -> None:
        with pytest.raises(ValueError, match="validation failed"):
            WebhookService._validate_and_convert_value("param", "bad", SegmentType.NUMBER, is_form_data=True)

    def test_process_parameters_should_raise_when_required_parameter_missing(self) -> None:
        raw_params = {"optional": "x"}
        config = [WebhookParameter(name="required_param", type=SegmentType.STRING, required=True)]

        with pytest.raises(ValueError, match="Required parameter missing"):
            WebhookService._process_parameters(raw_params, config, is_form_data=True)

    def test_process_parameters_should_include_unconfigured_parameters(self) -> None:
        raw_params = {"known": "1", "unknown": "x"}
        config = [WebhookParameter(name="known", type=SegmentType.NUMBER, required=False)]

        result = WebhookService._process_parameters(raw_params, config, is_form_data=True)

        assert result == {"known": 1, "unknown": "x"}

    def test_process_body_parameters_should_raise_when_required_text_raw_is_missing(self) -> None:
        with pytest.raises(ValueError, match="Required body content missing"):
            WebhookService._process_body_parameters(
                raw_body={"raw": ""},
                body_configs=[WebhookBodyParameter(name="raw", required=True)],
                content_type=ContentType.TEXT,
            )

    def test_process_body_parameters_should_skip_file_config_for_multipart_form_data(self) -> None:
        raw_body = {"message": "hello", "extra": "x"}
        body_configs = [
            WebhookBodyParameter(name="upload", type=SegmentType.FILE, required=True),
            WebhookBodyParameter(name="message", type=SegmentType.STRING, required=True),
        ]

        result = WebhookService._process_body_parameters(raw_body, body_configs, ContentType.FORM_DATA)

        assert result == {"message": "hello", "extra": "x"}

    def test_validate_required_headers_should_accept_sanitized_header_names(self) -> None:
        headers = {"x_api_key": "123"}
        configs = [WebhookParameter(name="x-api-key", required=True)]

        WebhookService._validate_required_headers(headers, configs)

    def test_validate_required_headers_should_raise_when_required_header_missing(self) -> None:
        headers = {"x-other": "123"}
        configs = [WebhookParameter(name="x-api-key", required=True)]

        with pytest.raises(ValueError, match="Required header missing"):
            WebhookService._validate_required_headers(headers, configs)

    def test_validate_http_metadata_should_return_content_type_mismatch_error(self) -> None:
        webhook_data = {"method": "POST", "headers": {"Content-Type": "application/json"}}
        node_data = WebhookData(method="post", content_type=ContentType.TEXT)

        result = WebhookService._validate_http_metadata(webhook_data, node_data)

        assert result["valid"] is False
        assert "Content-type mismatch" in result["error"]

    def test_extract_content_type_should_fallback_to_lowercase_header_key(self) -> None:
        headers = {"content-type": "application/json; charset=utf-8"}
        assert WebhookService._extract_content_type(headers) == "application/json"

    def test_build_workflow_inputs_should_include_expected_keys(self) -> None:
        webhook_data = {"headers": {"h": "v"}, "query_params": {"q": 1}, "body": {"b": 2}}

        result = WebhookService.build_workflow_inputs(webhook_data)

        assert result["webhook_data"] == webhook_data
        assert result["webhook_headers"] == {"h": "v"}
        assert result["webhook_query_params"] == {"q": 1}
        assert result["webhook_body"] == {"b": 2}


class TestWebhookServiceExecutionAndSync:
    def test_trigger_workflow_execution_should_trigger_async_workflow_successfully(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = _workflow_trigger(
            app_id="app-1",
            node_id="node-1",
            tenant_id="tenant-1",
            webhook_id="webhook-1",
        )
        workflow = _workflow(id="wf-1")
        webhook_data = {"body": {"x": 1}}

        session = MagicMock()
        _patch_session(monkeypatch, session)

        end_user = SimpleNamespace(id="end-user-1")
        monkeypatch.setattr(
            service_module.EndUserService,
            "get_or_create_end_user_by_type",
            MagicMock(return_value=end_user),
        )
        quota_type = SimpleNamespace(TRIGGER=SimpleNamespace(consume=MagicMock()))
        monkeypatch.setattr(service_module, "QuotaType", quota_type)
        trigger_async_mock = MagicMock()
        monkeypatch.setattr(service_module.AsyncWorkflowService, "trigger_workflow_async", trigger_async_mock)

        WebhookService.trigger_workflow_execution(webhook_trigger, webhook_data, workflow)

        trigger_async_mock.assert_called_once()

    def test_trigger_workflow_execution_should_mark_tenant_rate_limited_when_quota_exceeded(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = _workflow_trigger(
            app_id="app-1",
            node_id="node-1",
            tenant_id="tenant-1",
            webhook_id="webhook-1",
        )
        workflow = _workflow(id="wf-1")

        session = MagicMock()
        _patch_session(monkeypatch, session)

        monkeypatch.setattr(
            service_module.EndUserService,
            "get_or_create_end_user_by_type",
            MagicMock(return_value=SimpleNamespace(id="end-user-1")),
        )
        quota_type = SimpleNamespace(
            TRIGGER=SimpleNamespace(
                consume=MagicMock(side_effect=QuotaExceededError(feature="trigger", tenant_id="tenant-1", required=1))
            )
        )
        monkeypatch.setattr(service_module, "QuotaType", quota_type)
        mark_rate_limited_mock = MagicMock()
        monkeypatch.setattr(
            service_module.AppTriggerService, "mark_tenant_triggers_rate_limited", mark_rate_limited_mock
        )

        with pytest.raises(QuotaExceededError):
            WebhookService.trigger_workflow_execution(webhook_trigger, {"body": {}}, workflow)

        mark_rate_limited_mock.assert_called_once_with("tenant-1")

    def test_trigger_workflow_execution_should_log_and_reraise_unexpected_errors(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        webhook_trigger = _workflow_trigger(
            app_id="app-1",
            node_id="node-1",
            tenant_id="tenant-1",
            webhook_id="webhook-1",
        )
        workflow = _workflow(id="wf-1")

        session = MagicMock()
        _patch_session(monkeypatch, session)

        monkeypatch.setattr(
            service_module.EndUserService,
            "get_or_create_end_user_by_type",
            MagicMock(side_effect=RuntimeError("boom")),
        )
        logger_exception_mock = MagicMock()
        monkeypatch.setattr(service_module.logger, "exception", logger_exception_mock)

        with pytest.raises(RuntimeError, match="boom"):
            WebhookService.trigger_workflow_execution(webhook_trigger, {"body": {}}, workflow)

        logger_exception_mock.assert_called_once()

    def test_sync_webhook_relationships_should_raise_when_workflow_exceeds_node_limit(self) -> None:
        app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
        workflow = _workflow(
            walk_nodes=lambda _node_type: [
                (f"node-{i}", {}) for i in range(WebhookService.MAX_WEBHOOK_NODES_PER_WORKFLOW + 1)
            ]
        )

        with pytest.raises(ValueError, match="maximum webhook node limit"):
            WebhookService.sync_webhook_relationships(app, workflow)

    def test_sync_webhook_relationships_should_raise_when_lock_not_acquired(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
        workflow = _workflow(walk_nodes=lambda _node_type: [("node-1", {})])

        lock = MagicMock()
        lock.acquire.return_value = False
        monkeypatch.setattr(service_module.redis_client, "get", MagicMock(return_value=None))
        monkeypatch.setattr(service_module.redis_client, "lock", MagicMock(return_value=lock))

        with pytest.raises(RuntimeError, match="Failed to acquire lock"):
            WebhookService.sync_webhook_relationships(app, workflow)

    def test_sync_webhook_relationships_should_create_missing_records_and_delete_stale_records(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
        workflow = _workflow(walk_nodes=lambda _node_type: [("node-new", {})])

        class _WorkflowWebhookTrigger:
            app_id = "app_id"
            tenant_id = "tenant_id"
            webhook_id = "webhook_id"
            node_id = "node_id"

            def __init__(self, app_id: str, tenant_id: str, node_id: str, webhook_id: str, created_by: str) -> None:
                self.id = None
                self.app_id = app_id
                self.tenant_id = tenant_id
                self.node_id = node_id
                self.webhook_id = webhook_id
                self.created_by = created_by

        class _Select:
            def where(self, *args: Any, **kwargs: Any) -> "_Select":
                return self

        class _Session:
            def __init__(self) -> None:
                self.added: list[Any] = []
                self.deleted: list[Any] = []
                self.commit_count = 0
                self.existing_records = [SimpleNamespace(node_id="node-stale")]

            def scalars(self, _stmt: Any) -> Any:
                return SimpleNamespace(all=lambda: self.existing_records)

            def add(self, obj: Any) -> None:
                self.added.append(obj)

            def flush(self) -> None:
                for idx, obj in enumerate(self.added, start=1):
                    if obj.id is None:
                        obj.id = f"rec-{idx}"

            def commit(self) -> None:
                self.commit_count += 1

            def delete(self, obj: Any) -> None:
                self.deleted.append(obj)

        lock = MagicMock()
        lock.acquire.return_value = True
        lock.release.return_value = None

        fake_session = _Session()

        monkeypatch.setattr(service_module, "WorkflowWebhookTrigger", _WorkflowWebhookTrigger)
        monkeypatch.setattr(service_module, "select", MagicMock(return_value=_Select()))
        monkeypatch.setattr(service_module.redis_client, "get", MagicMock(return_value=None))
        monkeypatch.setattr(service_module.redis_client, "lock", MagicMock(return_value=lock))
        redis_set_mock = MagicMock()
        redis_delete_mock = MagicMock()
        monkeypatch.setattr(service_module.redis_client, "set", redis_set_mock)
        monkeypatch.setattr(service_module.redis_client, "delete", redis_delete_mock)
        monkeypatch.setattr(WebhookService, "generate_webhook_id", MagicMock(return_value="generated-webhook-id"))
        _patch_session(monkeypatch, fake_session)

        WebhookService.sync_webhook_relationships(app, workflow)

        assert len(fake_session.added) == 1
        assert len(fake_session.deleted) == 1
        redis_set_mock.assert_called_once()
        redis_delete_mock.assert_called_once()
        lock.release.assert_called_once()

    def test_sync_webhook_relationships_should_log_when_lock_release_fails(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        app = _app(id="app-1", tenant_id="tenant-1", created_by="user-1")
        workflow = _workflow(walk_nodes=lambda _node_type: [])

        class _Select:
            def where(self, *args: Any, **kwargs: Any) -> "_Select":
                return self

        class _Session:
            def scalars(self, _stmt: Any) -> Any:
                return SimpleNamespace(all=lambda: [])

            def commit(self) -> None:
                return None

        lock = MagicMock()
        lock.acquire.return_value = True
        lock.release.side_effect = RuntimeError("release failed")

        logger_exception_mock = MagicMock()

        monkeypatch.setattr(service_module, "select", MagicMock(return_value=_Select()))
        monkeypatch.setattr(service_module.redis_client, "get", MagicMock(return_value=None))
        monkeypatch.setattr(service_module.redis_client, "lock", MagicMock(return_value=lock))
        monkeypatch.setattr(service_module.logger, "exception", logger_exception_mock)
        _patch_session(monkeypatch, _Session())

        WebhookService.sync_webhook_relationships(app, workflow)

        assert logger_exception_mock.call_count == 1


class TestWebhookServiceUtilities:
    def test_generate_webhook_response_should_fallback_when_response_body_is_not_json(self) -> None:
        node_config = {"data": {"status_code": 200, "response_body": "{bad-json"}}

        body, status = WebhookService.generate_webhook_response(node_config)

        assert status == 200
        assert "message" in body

    def test_generate_webhook_id_should_return_24_character_identifier(self) -> None:
        webhook_id = WebhookService.generate_webhook_id()

        assert isinstance(webhook_id, str)
        assert len(webhook_id) == 24

    def test_sanitize_key_should_return_original_value_for_non_string_input(self) -> None:
        result = WebhookService._sanitize_key(123)  # type: ignore[arg-type]
        assert result == 123
