"""Real HTTP requests and value conversion retain the native webhook contract."""

from collections.abc import Mapping

import pytest
from flask import Flask, request
from werkzeug.exceptions import RequestEntityTooLarge

from controllers.trigger.webhook_request import WebhookRequestParser
from core.app.file_access import DatabaseFileAccessController
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.nodes.trigger_webhook.entities import (
    ContentType,
    WebhookBodyParameter,
    WebhookData,
    WebhookParameter,
)
from graphon.entities.graph_config import NodeConfigDict
from graphon.variables.types import SegmentType
from services.trigger.webhook_gateway import ToolWebhookFiles
from services.trigger.webhook_service import RawWebhookDataDict, WebhookContext, build_webhook_workflow_inputs
from tests.helpers.unit.config_override import config_overrides_context


@pytest.fixture
def flask_app() -> Flask:
    return Flask(__name__)


@pytest.fixture
def parser() -> WebhookRequestParser:
    return WebhookRequestParser(
        request=request, files=ToolWebhookFiles(manager=ToolFileManager(), access=DatabaseFileAccessController())
    )


def _webhook_trigger() -> WebhookContext:
    return WebhookContext(
        tenant_id="tenant-123",
        app_id="app-123",
        node_id="node-123",
        created_by="account-123",
        webhook_id="webhook-123",
        workflow_id="workflow-123",
        node_config=_node({}),
        status=None,
    )


def _workflow_trigger() -> WebhookContext:
    return _webhook_trigger()


class TestWebhookRequestParserUnit:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("1234567890123456789", 1234567890123456789),
            ("9007199254740993", 9007199254740993),
            ("-9007199254740993", -9007199254740993),
            ("1e3", 1000),
        ],
    )
    def test_form_number_preserves_exact_integers(self, parser: WebhookRequestParser, raw: str, expected: int) -> None:
        assert parser._convert_form_value("amount", raw, SegmentType.NUMBER) == expected

    @pytest.mark.parametrize("raw", ["nan", "NaN", "inf", "-Infinity", "1e400"])
    def test_form_number_rejects_non_finite_values(self, parser: WebhookRequestParser, raw: str) -> None:
        with pytest.raises(ValueError, match="to number"):
            parser._convert_form_value("amount", raw, SegmentType.NUMBER)

    @pytest.mark.parametrize(("value", "kind"), [(True, "number"), ([1, True], "array[number]")])
    def test_json_number_rejects_booleans(self, parser: WebhookRequestParser, value: object, kind: str) -> None:
        with pytest.raises(ValueError, match="Expected"):
            parser._validate_json_value("amount", value, kind)

    def test_rejects_oversized_request(self, parser: WebhookRequestParser, flask_app: Flask) -> None:
        with config_overrides_context(WEBHOOK_REQUEST_BODY_MAX_SIZE=1):
            with flask_app.test_request_context("/webhook", method="POST", data="ab"):
                with pytest.raises(RequestEntityTooLarge):
                    parser.extract_webhook_data(_webhook_trigger())

    def test_extract_webhook_data_json(self, parser: WebhookRequestParser) -> None:
        """Test webhook data extraction from JSON request."""
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer token"},
            query_string="version=1&format=json",
            json={"message": "hello", "count": 42},
        ):
            webhook_trigger = _webhook_trigger()
            webhook_data = parser.extract_webhook_data(webhook_trigger)
            assert webhook_data["method"] == "POST"
            assert webhook_data["headers"]["Authorization"] == "Bearer token"
            assert webhook_data["query_params"]["version"] == "1"
            assert webhook_data["query_params"]["format"] == "json"
            assert webhook_data["body"]["message"] == "hello"
            assert webhook_data["body"]["count"] == 42
            assert webhook_data["files"] == {}

    def test_extract_webhook_data_query_params_remain_strings(self, parser: WebhookRequestParser) -> None:
        """Query parameters should be extracted as raw strings without automatic conversion."""
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook",
            method="GET",
            headers={"Content-Type": "application/json"},
            query_string="count=42&threshold=3.14&enabled=true&note=text",
        ):
            webhook_trigger = _webhook_trigger()
            webhook_data = parser.extract_webhook_data(webhook_trigger)
            assert webhook_data["query_params"]["count"] == "42"
            assert webhook_data["query_params"]["threshold"] == "3.14"
            assert webhook_data["query_params"]["enabled"] == "true"
            assert webhook_data["query_params"]["note"] == "text"

    def test_extract_webhook_data_form_urlencoded(self, parser: WebhookRequestParser) -> None:
        """Test webhook data extraction from form URL encoded request."""
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"username": "test", "password": "secret"},
        ):
            webhook_trigger = _webhook_trigger()
            webhook_data = parser.extract_webhook_data(webhook_trigger)
            assert webhook_data["method"] == "POST"
            assert webhook_data["body"]["username"] == "test"
            assert webhook_data["body"]["password"] == "secret"

    def test_extract_webhook_data_raw_text(self, parser: WebhookRequestParser) -> None:
        """Test webhook data extraction from raw text request."""
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "text/plain"}, data="raw text content"
        ):
            webhook_trigger = _webhook_trigger()
            webhook_data = parser.extract_webhook_data(webhook_trigger)
            assert webhook_data["method"] == "POST"
            assert webhook_data["body"]["raw"] == "raw text content"

    def test_extract_webhook_data_invalid_json(self, parser: WebhookRequestParser) -> None:
        """Test webhook data extraction with invalid JSON."""
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "application/json"}, data="invalid json"
        ):
            webhook_trigger = _webhook_trigger()
            with pytest.raises(ValueError, match="Invalid JSON body"):
                parser.extract_webhook_data(webhook_trigger)

    def test_generate_webhook_response_default(self, parser: WebhookRequestParser) -> None:
        """Test webhook response generation with default values."""
        node_config = _node({})
        response_data, status_code = parser.generate_webhook_response(node_config)
        assert status_code == 200
        assert response_data["status"] == "success"
        assert "Webhook processed successfully" in response_data["message"]

    def test_generate_webhook_response_custom_json(self, parser: WebhookRequestParser) -> None:
        """Test webhook response generation with custom JSON response."""
        node_config = _node({"status_code": 201, "response_body": '{"result": "created", "id": 123}'})
        response_data, status_code = parser.generate_webhook_response(node_config)
        assert status_code == 201
        assert response_data["result"] == "created"
        assert response_data["id"] == 123

    def test_generate_webhook_response_custom_text(self, parser: WebhookRequestParser) -> None:
        """Test webhook response generation with custom text response."""
        node_config = _node({"status_code": 202, "response_body": "Request accepted for processing"})
        response_data, status_code = parser.generate_webhook_response(node_config)
        assert status_code == 202
        assert response_data["message"] == "Request accepted for processing"

    def test_generate_webhook_response_invalid_json(self, parser: WebhookRequestParser) -> None:
        """Test webhook response generation with invalid JSON response."""
        node_config = _node({"status_code": 400, "response_body": '{"invalid": json}'})
        response_data, status_code = parser.generate_webhook_response(node_config)
        assert status_code == 400
        assert response_data["message"] == '{"invalid": json}'

    def test_generate_webhook_response_empty_response_body(self, parser: WebhookRequestParser) -> None:
        """Test webhook response generation with empty response body."""
        node_config = _node({"status_code": 204, "response_body": ""})
        response_data, status_code = parser.generate_webhook_response(node_config)
        assert status_code == 204
        assert response_data["status"] == "success"
        assert "Webhook processed successfully" in response_data["message"]

    def test_generate_webhook_response_array_json(self, parser: WebhookRequestParser) -> None:
        """Test webhook response generation with JSON array response."""
        node_config = _node({"status_code": 200, "response_body": '[{"id": 1}, {"id": 2}]'})
        response_data, status_code = parser.generate_webhook_response(node_config)
        assert status_code == 200
        assert isinstance(response_data, list)
        assert len(response_data) == 2
        assert response_data[0]["id"] == 1
        assert response_data[1]["id"] == 2

    def test_validate_json_value_string(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for string type."""
        result = parser._validate_json_value("name", "hello", "string")
        assert result == "hello"
        with pytest.raises(ValueError, match="Expected string, got int"):
            parser._validate_json_value("name", 123, "string")

    def test_validate_json_value_number(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for number type."""
        result = parser._validate_json_value("count", 42, "number")
        assert result == 42
        result = parser._validate_json_value("price", 19.99, "number")
        assert result == 19.99
        with pytest.raises(ValueError, match="Expected number, got str"):
            parser._validate_json_value("count", "42", "number")

    def test_validate_json_value_bool(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for boolean type."""
        result = parser._validate_json_value("enabled", True, "boolean")
        assert result is True
        result = parser._validate_json_value("enabled", False, "boolean")
        assert result is False
        with pytest.raises(ValueError, match="Expected boolean, got str"):
            parser._validate_json_value("enabled", "true", "boolean")

    def test_validate_json_value_object(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for object type."""
        result = parser._validate_json_value("user", {"name": "John", "age": 30}, "object")
        assert result == {"name": "John", "age": 30}
        with pytest.raises(ValueError, match="Expected object, got str"):
            parser._validate_json_value("user", "not_an_object", "object")

    def test_validate_json_value_array_string(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for array[string] type."""
        result = parser._validate_json_value("tags", ["tag1", "tag2", "tag3"], "array[string]")
        assert result == ["tag1", "tag2", "tag3"]
        with pytest.raises(ValueError, match="Expected array of strings, got str"):
            parser._validate_json_value("tags", "not_an_array", "array[string]")
        with pytest.raises(ValueError, match="Expected array of strings, got list"):
            parser._validate_json_value("tags", ["tag1", 123, "tag3"], "array[string]")

    def test_validate_json_value_array_number(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for array[number] type."""
        result = parser._validate_json_value("scores", [1, 2.5, 3, 4.7], "array[number]")
        assert result == [1, 2.5, 3, 4.7]
        with pytest.raises(ValueError, match="Expected array of numbers, got list"):
            parser._validate_json_value("scores", [1, "2", 3], "array[number]")

    def test_validate_json_value_array_bool(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for array[boolean] type."""
        result = parser._validate_json_value("flags", [True, False, True], "array[boolean]")
        assert result == [True, False, True]
        with pytest.raises(ValueError, match="Expected array of booleans, got list"):
            parser._validate_json_value("flags", [True, "false", True], "array[boolean]")

    def test_validate_json_value_array_object(self, parser: WebhookRequestParser) -> None:
        """Test JSON value validation for array[object] type."""
        result = parser._validate_json_value("users", [{"name": "John"}, {"name": "Jane"}], "array[object]")
        assert result == [{"name": "John"}, {"name": "Jane"}]
        with pytest.raises(ValueError, match="Expected array of objects, got list"):
            parser._validate_json_value("users", [{"name": "John"}, "not_object"], "array[object]")

    def test_convert_form_value_string(self, parser: WebhookRequestParser) -> None:
        """Test form value conversion for string type."""
        result = parser._convert_form_value("test", "hello", "string")
        assert result == "hello"

    def test_convert_form_value_number(self, parser: WebhookRequestParser) -> None:
        """Test form value conversion for number type."""
        result = parser._convert_form_value("count", "42", "number")
        assert result == 42
        result = parser._convert_form_value("price", "19.99", "number")
        assert result == 19.99
        with pytest.raises(ValueError, match="Cannot convert 'not_a_number' to number"):
            parser._convert_form_value("count", "not_a_number", "number")

    def test_convert_form_value_boolean(self, parser: WebhookRequestParser) -> None:
        """Test form value conversion for boolean type."""
        assert parser._convert_form_value("flag", "true", "boolean") is True
        assert parser._convert_form_value("flag", "1", "boolean") is True
        assert parser._convert_form_value("flag", "yes", "boolean") is True
        assert parser._convert_form_value("flag", "false", "boolean") is False
        assert parser._convert_form_value("flag", "0", "boolean") is False
        assert parser._convert_form_value("flag", "no", "boolean") is False
        with pytest.raises(ValueError, match="Cannot convert 'maybe' to boolean"):
            parser._convert_form_value("flag", "maybe", "boolean")

    def test_extract_and_validate_webhook_data_success(self, parser: WebhookRequestParser) -> None:
        """Test successful unified data extraction and validation."""
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json"},
            query_string="count=42&enabled=true",
            json={"message": "hello", "age": 25},
        ):
            webhook_trigger = _webhook_trigger()
            node_config = _node(
                {
                    "method": "post",
                    "content_type": "application/json",
                    "params": [
                        {"name": "count", "type": "number", "required": True},
                        {"name": "enabled", "type": "boolean", "required": True},
                    ],
                    "body": [
                        {"name": "message", "type": "string", "required": True},
                        {"name": "age", "type": "number", "required": True},
                    ],
                }
            )
            result = parser.extract_and_validate_webhook_data(webhook_trigger, node_config)
            assert result["query_params"]["count"] == 42
            assert result["query_params"]["enabled"] is True
            assert result["body"]["message"] == "hello"
            assert result["body"]["age"] == 25

    def test_extract_and_validate_webhook_data_invalid_json_error(self, parser: WebhookRequestParser) -> None:
        """Invalid JSON should bubble up as a ValueError with details."""
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "application/json"}, data='{"invalid": }'
        ):
            webhook_trigger = _webhook_trigger()
            node_config = _node({"method": "post", "content_type": "application/json"})
            with pytest.raises(ValueError, match="Invalid JSON body"):
                parser.extract_and_validate_webhook_data(webhook_trigger, node_config)

    def test_extract_and_validate_webhook_data_validation_error(self, parser: WebhookRequestParser) -> None:
        """Test unified data extraction with validation error."""
        app = Flask(__name__)
        with app.test_request_context("/webhook", method="GET", headers={"Content-Type": "application/json"}):
            webhook_trigger = _webhook_trigger()
            node_config = _node({"method": "post", "content_type": "application/json"})
            with pytest.raises(ValueError, match="HTTP method mismatch"):
                parser.extract_and_validate_webhook_data(webhook_trigger, node_config)

    def test_extract_and_validate_webhook_request_missing_required_header(self, parser: WebhookRequestParser) -> None:
        app = Flask(__name__)
        with app.test_request_context("/webhook", method="POST", headers={"Content-Type": "application/json"}):
            node_config = _node(
                {
                    "method": "post",
                    "content_type": "application/json",
                    "headers": [{"name": "Authorization", "required": True}],
                }
            )
            with pytest.raises(ValueError, match="Required header missing: Authorization"):
                parser.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

    def test_extract_and_validate_webhook_request_case_insensitive_headers(self, parser: WebhookRequestParser) -> None:
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook",
            method="POST",
            headers={"Content-Type": "application/json", "authorization": "Bearer token"},
            json={"message": "hello"},
        ):
            node_config = _node(
                {
                    "method": "post",
                    "content_type": "application/json",
                    "headers": [{"name": "Authorization", "required": True}],
                    "body": [{"name": "message", "type": "string", "required": True}],
                }
            )
            result = parser.extract_and_validate_webhook_data(_webhook_trigger(), node_config)
        assert result["headers"].get("Authorization") == "Bearer token"

    def test_extract_and_validate_webhook_request_missing_required_param(self, parser: WebhookRequestParser) -> None:
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook", method="POST", headers={"Content-Type": "application/json"}, json={"message": "hello"}
        ):
            node_config = _node(
                {
                    "method": "post",
                    "content_type": "application/json",
                    "params": [{"name": "version", "required": True}],
                    "body": [{"name": "message", "type": "string", "required": True}],
                }
            )
            with pytest.raises(ValueError, match="Required parameter missing: version"):
                parser.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

    def test_extract_and_validate_webhook_request_missing_required_body_param(
        self, parser: WebhookRequestParser
    ) -> None:
        app = Flask(__name__)
        with app.test_request_context("/webhook", method="POST", headers={"Content-Type": "application/json"}, json={}):
            node_config = _node(
                {
                    "method": "post",
                    "content_type": "application/json",
                    "body": [{"name": "message", "type": "string", "required": True}],
                }
            )
            with pytest.raises(ValueError, match="Required body parameter missing: message"):
                parser.extract_and_validate_webhook_data(_webhook_trigger(), node_config)

    def test_extract_and_validate_webhook_request_missing_required_file(self, parser: WebhookRequestParser) -> None:
        app = Flask(__name__)
        with app.test_request_context(
            "/webhook", method="POST", data={"note": "test"}, content_type="multipart/form-data"
        ):
            node_config = _node(
                {
                    "method": "post",
                    "content_type": "multipart/form-data",
                    "body": [{"name": "file", "type": "file", "required": True}],
                }
            )
            result = parser.extract_and_validate_webhook_data(_webhook_trigger(), node_config)
        assert result["files"] == {}


class TestWebhookRequestParserExtractionFallbacks:
    def test_extract_octet_stream_body_should_return_none_when_empty_payload(
        self, parser: WebhookRequestParser, flask_app: Flask
    ) -> None:
        webhook_trigger = _workflow_trigger()
        with flask_app.test_request_context("/webhook", method="POST", data=b""):
            body, files = parser._extract_octet_stream_body(webhook_trigger)
        assert body == {"raw": None}
        assert files == {}


class TestWebhookRequestParserValidationAndConversion:
    @pytest.mark.parametrize(
        ("raw_value", "param_type", "expected"),
        [
            ("42", SegmentType.NUMBER, 42),
            ("3.14", SegmentType.NUMBER, float("3.14")),
            ("yes", SegmentType.BOOLEAN, True),
            ("no", SegmentType.BOOLEAN, False),
        ],
    )
    def test_convert_form_value_should_convert_supported_types(
        self, parser: WebhookRequestParser, raw_value: str, param_type: str, expected: object
    ) -> None:
        result = parser._convert_form_value("param", raw_value, param_type)
        assert result == expected

    def test_convert_form_value_should_raise_for_unsupported_type(self, parser: WebhookRequestParser) -> None:
        with pytest.raises(ValueError, match="Unsupported type"):
            parser._convert_form_value("p", "x", SegmentType.FILE)

    def test_validate_and_convert_value_should_wrap_conversion_errors(self, parser: WebhookRequestParser) -> None:
        with pytest.raises(ValueError, match="validation failed"):
            parser._validate_and_convert_value("param", "bad", SegmentType.NUMBER, is_form_data=True)

    def test_process_parameters_should_raise_when_required_parameter_missing(
        self, parser: WebhookRequestParser
    ) -> None:
        raw_params = {"optional": "x"}
        config = [WebhookParameter(name="required_param", type=SegmentType.STRING, required=True)]
        with pytest.raises(ValueError, match="Required parameter missing"):
            parser._process_parameters(raw_params, config, is_form_data=True)

    def test_process_parameters_should_include_unconfigured_parameters(self, parser: WebhookRequestParser) -> None:
        raw_params = {"known": "1", "unknown": "x"}
        config = [WebhookParameter(name="known", type=SegmentType.NUMBER, required=False)]
        result = parser._process_parameters(raw_params, config, is_form_data=True)
        assert result == {"known": 1, "unknown": "x"}

    def test_process_body_parameters_should_raise_when_required_text_raw_is_missing(
        self, parser: WebhookRequestParser
    ) -> None:
        with pytest.raises(ValueError, match="Required body content missing"):
            parser._process_body_parameters(
                raw_body={"raw": ""},
                body_configs=[WebhookBodyParameter(name="raw", required=True)],
                content_type=ContentType.TEXT,
            )

    def test_process_body_parameters_should_skip_file_config_for_multipart_form_data(
        self, parser: WebhookRequestParser
    ) -> None:
        raw_body = {"message": "hello", "extra": "x"}
        body_configs = [
            WebhookBodyParameter(name="upload", type=SegmentType.FILE, required=True),
            WebhookBodyParameter(name="message", type=SegmentType.STRING, required=True),
        ]
        result = parser._process_body_parameters(raw_body, body_configs, ContentType.FORM_DATA)
        assert result == {"message": "hello", "extra": "x"}

    def test_validate_required_headers_should_accept_sanitized_header_names(self, parser: WebhookRequestParser) -> None:
        headers = {"x_api_key": "123"}
        configs = [WebhookParameter(name="x-api-key", required=True)]
        parser._validate_required_headers(headers, configs)

    def test_validate_required_headers_should_raise_when_required_header_missing(
        self, parser: WebhookRequestParser
    ) -> None:
        headers = {"x-other": "123"}
        configs = [WebhookParameter(name="x-api-key", required=True)]
        with pytest.raises(ValueError, match="Required header missing"):
            parser._validate_required_headers(headers, configs)

    def test_validate_http_metadata_should_return_content_type_mismatch_error(
        self, parser: WebhookRequestParser
    ) -> None:
        webhook_data: RawWebhookDataDict = {
            "method": "POST",
            "headers": {"Content-Type": "application/json"},
            "query_params": {},
            "body": {},
            "files": {},
        }
        node_data = WebhookData(method="post", content_type=ContentType.TEXT)
        result = parser._validate_http_metadata(webhook_data, node_data)
        assert result["valid"] is False
        assert "Content-type mismatch" in result["error"]

    def test_extract_content_type_should_fallback_to_lowercase_header_key(self, parser: WebhookRequestParser) -> None:
        headers = {"content-type": "application/json; charset=utf-8"}
        assert parser._extract_content_type(headers) == "application/json"

    def test_build_workflow_inputs_should_include_expected_keys(self) -> None:
        webhook_data: RawWebhookDataDict = {
            "headers": {"h": "v"},
            "query_params": {"q": 1},
            "body": {"b": 2},
            "method": "POST",
            "files": {},
        }
        result = build_webhook_workflow_inputs(webhook_data)
        assert result["webhook_data"] == webhook_data
        assert result["webhook_headers"] == {"h": "v"}
        assert result["webhook_query_params"] == {"q": 1}
        assert result["webhook_body"] == {"b": 2}


class TestWebhookRequestParserUtilities:
    def test_generate_webhook_response_should_fallback_when_response_body_is_not_json(
        self, parser: WebhookRequestParser
    ) -> None:
        node_config = _node({"status_code": 200, "response_body": "{bad-json"})
        body, status = parser.generate_webhook_response(node_config)
        assert status == 200
        assert "message" in body


def _node(data: Mapping[str, object]) -> NodeConfigDict:
    return {"id": "hook", "data": WebhookData.model_validate(data)}
