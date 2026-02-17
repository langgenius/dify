import base64

import httpx
import pytest

from configs import dify_config
from core.file.enums import FileTransferMethod
from core.workflow.nodes.http_request import (
    BodyData,
    HttpRequestNodeAuthorization,
    HttpRequestNodeBody,
    HttpRequestNodeData,
)
from core.workflow.nodes.http_request.entities import HttpRequestNodeTimeout
from core.workflow.nodes.http_request.exc import (
    AuthorizationConfigError,
    FileFetchError,
    HttpRequestNodeError,
    InvalidHttpMethodError,
    InvalidURLError,
    RequestBodyError,
    ResponseSizeError,
)
from core.workflow.nodes.http_request.executor import Executor
from core.workflow.runtime import VariablePool
from core.workflow.system_variable import SystemVariable


def test_executor_with_json_body_and_number_variable():
    # Prepare the variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    variable_pool.add(["pre_node_id", "number"], 42)

    # Prepare the node data
    node_data = HttpRequestNodeData(
        title="Test JSON Body with Number Variable",
        method="post",
        url="https://api.example.com/data",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="Content-Type: application/json",
        params="",
        body=HttpRequestNodeBody(
            type="json",
            data=[
                BodyData(
                    key="",
                    type="text",
                    value='{"number": {{#pre_node_id.number#}}}',
                )
            ],
        ),
    )

    # Initialize the Executor
    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    # Check the executor's data
    assert executor.method == "post"
    assert executor.url == "https://api.example.com/data"
    assert executor.headers == {"Content-Type": "application/json"}
    assert executor.params is None
    assert executor.json == {"number": 42}
    assert executor.data is None
    assert executor.files is None
    assert executor.content is None

    # Check the raw request (to_log method)
    raw_request = executor.to_log()
    assert "POST /data HTTP/1.1" in raw_request
    assert "Host: api.example.com" in raw_request
    assert "Content-Type: application/json" in raw_request
    assert '{"number": 42}' in raw_request


def test_executor_with_json_body_and_object_variable():
    # Prepare the variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    variable_pool.add(["pre_node_id", "object"], {"name": "John Doe", "age": 30, "email": "john@example.com"})

    # Prepare the node data
    node_data = HttpRequestNodeData(
        title="Test JSON Body with Object Variable",
        method="post",
        url="https://api.example.com/data",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="Content-Type: application/json",
        params="",
        body=HttpRequestNodeBody(
            type="json",
            data=[
                BodyData(
                    key="",
                    type="text",
                    value="{{#pre_node_id.object#}}",
                )
            ],
        ),
    )

    # Initialize the Executor
    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    # Check the executor's data
    assert executor.method == "post"
    assert executor.url == "https://api.example.com/data"
    assert executor.headers == {"Content-Type": "application/json"}
    assert executor.params is None
    assert executor.json == {"name": "John Doe", "age": 30, "email": "john@example.com"}
    assert executor.data is None
    assert executor.files is None
    assert executor.content is None

    # Check the raw request (to_log method)
    raw_request = executor.to_log()
    assert "POST /data HTTP/1.1" in raw_request
    assert "Host: api.example.com" in raw_request
    assert "Content-Type: application/json" in raw_request
    assert '"name": "John Doe"' in raw_request
    assert '"age": 30' in raw_request
    assert '"email": "john@example.com"' in raw_request


def test_executor_with_json_body_and_nested_object_variable():
    # Prepare the variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    variable_pool.add(["pre_node_id", "object"], {"name": "John Doe", "age": 30, "email": "john@example.com"})

    # Prepare the node data
    node_data = HttpRequestNodeData(
        title="Test JSON Body with Nested Object Variable",
        method="post",
        url="https://api.example.com/data",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="Content-Type: application/json",
        params="",
        body=HttpRequestNodeBody(
            type="json",
            data=[
                BodyData(
                    key="",
                    type="text",
                    value='{"object": {{#pre_node_id.object#}}}',
                )
            ],
        ),
    )

    # Initialize the Executor
    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    # Check the executor's data
    assert executor.method == "post"
    assert executor.url == "https://api.example.com/data"
    assert executor.headers == {"Content-Type": "application/json"}
    assert executor.params is None
    assert executor.json == {"object": {"name": "John Doe", "age": 30, "email": "john@example.com"}}
    assert executor.data is None
    assert executor.files is None
    assert executor.content is None

    # Check the raw request (to_log method)
    raw_request = executor.to_log()
    assert "POST /data HTTP/1.1" in raw_request
    assert "Host: api.example.com" in raw_request
    assert "Content-Type: application/json" in raw_request
    assert '"object": {' in raw_request
    assert '"name": "John Doe"' in raw_request
    assert '"age": 30' in raw_request
    assert '"email": "john@example.com"' in raw_request


def test_extract_selectors_from_template_with_newline():
    variable_pool = VariablePool(system_variables=SystemVariable.default())
    variable_pool.add(("node_id", "custom_query"), "line1\nline2")
    node_data = HttpRequestNodeData(
        title="Test JSON Body with Nested Object Variable",
        method="post",
        url="https://api.example.com/data",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="Content-Type: application/json",
        params="test: {{#node_id.custom_query#}}",
        body=HttpRequestNodeBody(
            type="none",
            data=[],
        ),
    )

    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    assert executor.params == [("test", "line1\nline2")]


def test_executor_with_form_data():
    # Prepare the variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    variable_pool.add(["pre_node_id", "text_field"], "Hello, World!")
    variable_pool.add(["pre_node_id", "number_field"], 42)

    # Prepare the node data
    node_data = HttpRequestNodeData(
        title="Test Form Data",
        method="post",
        url="https://api.example.com/upload",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="Content-Type: multipart/form-data",
        params="",
        body=HttpRequestNodeBody(
            type="form-data",
            data=[
                BodyData(
                    key="text_field",
                    type="text",
                    value="{{#pre_node_id.text_field#}}",
                ),
                BodyData(
                    key="number_field",
                    type="text",
                    value="{{#pre_node_id.number_field#}}",
                ),
            ],
        ),
    )

    # Initialize the Executor
    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    # Check the executor's data
    assert executor.method == "post"
    assert executor.url == "https://api.example.com/upload"
    assert executor.params is None
    assert executor.json is None
    # '__multipart_placeholder__' is expected when no file inputs exist,
    # to ensure the request is treated as multipart/form-data by the backend.
    assert executor.files == [("__multipart_placeholder__", ("", b"", "application/octet-stream"))]
    assert executor.content is None

    # After fix for #23829: When placeholder files exist, Content-Type is removed
    # to let httpx handle Content-Type and boundary automatically
    headers = executor._assembling_headers()
    assert "Content-Type" not in headers or "multipart/form-data" not in headers.get("Content-Type", "")

    # Check that the form data is correctly loaded in executor.data
    assert isinstance(executor.data, dict)
    assert "text_field" in executor.data
    assert executor.data["text_field"] == "Hello, World!"
    assert "number_field" in executor.data
    assert executor.data["number_field"] == "42"

    # Check the raw request (to_log method)
    raw_request = executor.to_log()
    assert "POST /upload HTTP/1.1" in raw_request
    assert "Host: api.example.com" in raw_request
    assert "Content-Type: multipart/form-data" in raw_request
    assert "text_field" in raw_request
    assert "Hello, World!" in raw_request
    assert "number_field" in raw_request
    assert "42" in raw_request


def test_init_headers():
    def create_executor(headers: str) -> Executor:
        node_data = HttpRequestNodeData(
            title="test",
            method="get",
            url="http://example.com",
            headers=headers,
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )
        timeout = HttpRequestNodeTimeout(connect=10, read=30, write=30)
        return Executor(
            node_data=node_data,
            timeout=timeout,
            variable_pool=VariablePool(system_variables=SystemVariable.default()),
        )

    executor = create_executor("aa\n cc:")
    executor._init_headers()
    assert executor.headers == {"aa": "", "cc": ""}

    executor = create_executor("aa:bb\n cc:dd")
    executor._init_headers()
    assert executor.headers == {"aa": "bb", "cc": "dd"}

    executor = create_executor("aa:bb\n cc:dd\n")
    executor._init_headers()
    assert executor.headers == {"aa": "bb", "cc": "dd"}

    executor = create_executor("aa:bb\n\n cc : dd\n\n")
    executor._init_headers()
    assert executor.headers == {"aa": "bb", "cc": "dd"}


def test_init_params():
    def create_executor(params: str) -> Executor:
        node_data = HttpRequestNodeData(
            title="test",
            method="get",
            url="http://example.com",
            headers="",
            params=params,
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )
        timeout = HttpRequestNodeTimeout(connect=10, read=30, write=30)
        return Executor(
            node_data=node_data,
            timeout=timeout,
            variable_pool=VariablePool(system_variables=SystemVariable.default()),
        )

    # Test basic key-value pairs
    executor = create_executor("key1:value1\nkey2:value2")
    executor._init_params()
    assert executor.params == [("key1", "value1"), ("key2", "value2")]

    # Test empty values
    executor = create_executor("key1:\nkey2:")
    executor._init_params()
    assert executor.params == [("key1", ""), ("key2", "")]

    # Test duplicate keys (which is allowed for params)
    executor = create_executor("key1:value1\nkey1:value2")
    executor._init_params()
    assert executor.params == [("key1", "value1"), ("key1", "value2")]

    # Test whitespace handling
    executor = create_executor(" key1 : value1 \n key2 : value2 ")
    executor._init_params()
    assert executor.params == [("key1", "value1"), ("key2", "value2")]

    # Test empty lines and extra whitespace
    executor = create_executor("key1:value1\n\nkey2:value2\n\n")
    executor._init_params()
    assert executor.params == [("key1", "value1"), ("key2", "value2")]


def test_empty_api_key_raises_error_bearer():
    """Test that empty API key raises AuthorizationConfigError for bearer auth."""
    variable_pool = VariablePool(system_variables=SystemVariable.default())
    node_data = HttpRequestNodeData(
        title="test",
        method="get",
        url="http://example.com",
        headers="",
        params="",
        authorization=HttpRequestNodeAuthorization(
            type="api-key",
            config={"type": "bearer", "api_key": ""},
        ),
    )
    timeout = HttpRequestNodeTimeout(connect=10, read=30, write=30)

    with pytest.raises(AuthorizationConfigError, match="API key is required"):
        Executor(
            node_data=node_data,
            timeout=timeout,
            variable_pool=variable_pool,
        )


def test_empty_api_key_raises_error_basic():
    """Test that empty API key raises AuthorizationConfigError for basic auth."""
    variable_pool = VariablePool(system_variables=SystemVariable.default())
    node_data = HttpRequestNodeData(
        title="test",
        method="get",
        url="http://example.com",
        headers="",
        params="",
        authorization=HttpRequestNodeAuthorization(
            type="api-key",
            config={"type": "basic", "api_key": ""},
        ),
    )
    timeout = HttpRequestNodeTimeout(connect=10, read=30, write=30)

    with pytest.raises(AuthorizationConfigError, match="API key is required"):
        Executor(
            node_data=node_data,
            timeout=timeout,
            variable_pool=variable_pool,
        )


def test_empty_api_key_raises_error_custom():
    """Test that empty API key raises AuthorizationConfigError for custom auth."""
    variable_pool = VariablePool(system_variables=SystemVariable.default())
    node_data = HttpRequestNodeData(
        title="test",
        method="get",
        url="http://example.com",
        headers="",
        params="",
        authorization=HttpRequestNodeAuthorization(
            type="api-key",
            config={"type": "custom", "api_key": "", "header": "X-Custom-Auth"},
        ),
    )
    timeout = HttpRequestNodeTimeout(connect=10, read=30, write=30)

    with pytest.raises(AuthorizationConfigError, match="API key is required"):
        Executor(
            node_data=node_data,
            timeout=timeout,
            variable_pool=variable_pool,
        )


def test_whitespace_only_api_key_raises_error():
    """Test that whitespace-only API key raises AuthorizationConfigError."""
    variable_pool = VariablePool(system_variables=SystemVariable.default())
    node_data = HttpRequestNodeData(
        title="test",
        method="get",
        url="http://example.com",
        headers="",
        params="",
        authorization=HttpRequestNodeAuthorization(
            type="api-key",
            config={"type": "bearer", "api_key": "   "},
        ),
    )
    timeout = HttpRequestNodeTimeout(connect=10, read=30, write=30)

    with pytest.raises(AuthorizationConfigError, match="API key is required"):
        Executor(
            node_data=node_data,
            timeout=timeout,
            variable_pool=variable_pool,
        )


def test_valid_api_key_works():
    """Test that valid API key works correctly for bearer auth."""
    variable_pool = VariablePool(system_variables=SystemVariable.default())
    node_data = HttpRequestNodeData(
        title="test",
        method="get",
        url="http://example.com",
        headers="",
        params="",
        authorization=HttpRequestNodeAuthorization(
            type="api-key",
            config={"type": "bearer", "api_key": "valid-api-key-123"},
        ),
    )
    timeout = HttpRequestNodeTimeout(connect=10, read=30, write=30)

    executor = Executor(
        node_data=node_data,
        timeout=timeout,
        variable_pool=variable_pool,
    )

    # Should not raise an error
    headers = executor._assembling_headers()
    assert "Authorization" in headers
    assert headers["Authorization"] == "Bearer valid-api-key-123"


def test_executor_with_json_body_and_unquoted_uuid_variable():
    """Test that unquoted UUID variables are correctly handled in JSON body.

    This test verifies the fix for issue #31436 where json_repair would truncate
    certain UUID patterns (like 57eeeeb1-...) when they appeared as unquoted values.
    """
    # UUID that triggers the json_repair truncation bug
    test_uuid = "57eeeeb1-450b-482c-81b9-4be77e95dee2"

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    variable_pool.add(["pre_node_id", "uuid"], test_uuid)

    node_data = HttpRequestNodeData(
        title="Test JSON Body with Unquoted UUID Variable",
        method="post",
        url="https://api.example.com/data",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="Content-Type: application/json",
        params="",
        body=HttpRequestNodeBody(
            type="json",
            data=[
                BodyData(
                    key="",
                    type="text",
                    # UUID variable without quotes - this is the problematic case
                    value='{"rowId": {{#pre_node_id.uuid#}}}',
                )
            ],
        ),
    )

    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    # The UUID should be preserved in full, not truncated
    assert executor.json == {"rowId": test_uuid}
    assert len(executor.json["rowId"]) == len(test_uuid)


def test_executor_with_json_body_and_unquoted_uuid_with_newlines():
    """Test that unquoted UUID variables with newlines in JSON are handled correctly.

    This is a specific case from issue #31436 where the JSON body contains newlines.
    """
    test_uuid = "57eeeeb1-450b-482c-81b9-4be77e95dee2"

    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    variable_pool.add(["pre_node_id", "uuid"], test_uuid)

    node_data = HttpRequestNodeData(
        title="Test JSON Body with Unquoted UUID and Newlines",
        method="post",
        url="https://api.example.com/data",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="Content-Type: application/json",
        params="",
        body=HttpRequestNodeBody(
            type="json",
            data=[
                BodyData(
                    key="",
                    type="text",
                    # JSON with newlines and unquoted UUID variable
                    value='{\n"rowId": {{#pre_node_id.uuid#}}\n}',
                )
            ],
        ),
    )

    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    # The UUID should be preserved in full
    assert executor.json == {"rowId": test_uuid}


def test_executor_with_json_body_preserves_numbers_and_strings():
    """Test that numbers are preserved and string values are properly quoted."""
    variable_pool = VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
    )
    variable_pool.add(["node", "count"], 42)
    variable_pool.add(["node", "id"], "abc-123")

    node_data = HttpRequestNodeData(
        title="Test JSON Body with mixed types",
        method="post",
        url="https://api.example.com/data",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="",
        params="",
        body=HttpRequestNodeBody(
            type="json",
            data=[
                BodyData(
                    key="",
                    type="text",
                    value='{"count": {{#node.count#}}, "id": {{#node.id#}}}',
                )
            ],
        ),
    )

    executor = Executor(
        node_data=node_data,
        timeout=HttpRequestNodeTimeout(connect=10, read=30, write=30),
        variable_pool=variable_pool,
    )

    assert executor.json["count"] == 42
    assert executor.json["id"] == "abc-123"


class DummyHttpClient:
    class MaxRetriesExceededError(Exception):
        pass

    class RequestError(Exception):
        pass

    max_retries_exceeded_error = MaxRetriesExceededError
    request_error = RequestError

    def __init__(self, response=None, raise_error=None):
        self._response = response
        self._raise = raise_error

    def get(self, **kwargs):
        if self._raise:
            raise self._raise("error")
        return self._response

    post = get
    put = get
    delete = get
    patch = get
    head = get


class DummyFile:
    def __init__(self):
        self.filename = "file.txt"
        self.mime_type = "text/plain"
        self.related_id = "1"
        self.transfer_method = FileTransferMethod.REMOTE_URL
        self.remote_url = None


class DummyFileManager:
    def download(self, file):
        return b"file-content"


class TestExecutor:
    def setup_method(self):
        self.variable_pool = VariablePool(system_variables=SystemVariable.default())

    def test_invalid_url_empty(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )
        with pytest.raises(InvalidURLError):
            Executor(
                node_data=node,
                timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
                variable_pool=self.variable_pool,
            )

    def test_invalid_url_scheme(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="ftp://invalid.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )
        with pytest.raises(InvalidURLError):
            Executor(
                node_data=node,
                timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
                variable_pool=self.variable_pool,
            )

    def test_raw_text_multiple_items_error(self):
        node = HttpRequestNodeData(
            title="t",
            method="post",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
            body=HttpRequestNodeBody(
                type="raw-text",
                data=[
                    BodyData(key="", type="text", value="a"),
                    BodyData(key="", type="text", value="b"),
                ],
            ),
        )

        with pytest.raises(RequestBodyError):
            Executor(
                node_data=node,
                timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
                variable_pool=self.variable_pool,
            )

    def test_binary_body_success(self, monkeypatch):
        dummy_file = DummyFile()

        class DummyFileVariable:
            def __init__(self, value):
                self.value = value

        def fake_get_file(self, selector):
            return DummyFileVariable(dummy_file)

        monkeypatch.setattr(
            type(self.variable_pool),
            "get_file",
            fake_get_file,
        )

        node = HttpRequestNodeData(
            title="t",
            method="post",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
            body=HttpRequestNodeBody(
                type="binary",
                data=[BodyData(key="", type="file", file=("node", "file"))],
            ),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
            file_manager=DummyFileManager(),
        )

        assert executor.content == b"file-content"

    def test_binary_file_not_found(self):
        node = HttpRequestNodeData(
            title="t",
            method="post",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
            body=HttpRequestNodeBody(
                type="binary",
                data=[BodyData(key="", type="file", file=("x", "y"))],
            ),
        )

        with pytest.raises(FileFetchError):
            Executor(
                node_data=node,
                timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
                variable_pool=self.variable_pool,
            )

    def test_invalid_http_method(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
            http_client=DummyHttpClient(response=httpx.Response(200)),
        )

        executor.method = "trace"

        with pytest.raises(InvalidHttpMethodError):
            executor.invoke()

    def test_http_client_request_error(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
            http_client=DummyHttpClient(raise_error=DummyHttpClient.RequestError),
        )

        with pytest.raises(HttpRequestNodeError):
            executor.invoke()

    def test_response_size_exceeded_text(self, monkeypatch):
        response = httpx.Response(200, content=b"x" * 10_000_000)

        monkeypatch.setattr(
            dify_config,
            "HTTP_REQUEST_NODE_MAX_TEXT_SIZE",
            1,
        )

        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
            http_client=DummyHttpClient(response=response),
        )

        with pytest.raises(ResponseSizeError):
            executor.invoke()

    def test_basic_auth_base64_encoding(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(
                type="api-key",
                config={"type": "basic", "api_key": "user:pass"},
            ),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
        )

        headers = executor._assembling_headers()
        encoded = base64.b64encode(b"user:pass").decode()
        assert headers["Authorization"] == f"Basic {encoded}"

    def test_to_log_masks_authorization(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(
                type="api-key",
                config={"type": "bearer", "api_key": "secretkey"},
            ),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
        )

        log = executor.to_log()
        assert "secretkey" not in log
        assert "*********" in log

    def test_full_invoke_success(self):
        response = httpx.Response(200, json={"ok": True})

        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
            http_client=DummyHttpClient(response=response),
        )

        result = executor.invoke()
        assert result.status_code == 200

    def test_body_none_type(self):
        node = HttpRequestNodeData(
            title="t",
            method="post",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
            body=HttpRequestNodeBody(type="none", data=[]),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
        )

        assert executor.content == ""

    def test_x_www_form_urlencoded_body(self):
        node = HttpRequestNodeData(
            title="t",
            method="post",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
            body=HttpRequestNodeBody(
                type="x-www-form-urlencoded",
                data=[
                    BodyData(key="a", type="text", value="1"),
                    BodyData(key="b", type="text", value="2"),
                ],
            ),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
        )

        assert executor.data == {"a": "1", "b": "2"}

    def test_custom_auth_header(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(
                type="api-key",
                config={"type": "custom", "api_key": "abc123", "header": "X-Auth"},
            ),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
        )

        headers = executor._assembling_headers()
        assert headers["X-Auth"] == "abc123"

    def test_basic_auth_without_colon(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(
                type="api-key",
                config={"type": "basic", "api_key": "encodedvalue"},
            ),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
        )

        headers = executor._assembling_headers()
        assert headers["Authorization"] == "Basic encodedvalue"

    def test_binary_response_size_exceeded(self, monkeypatch):
        response = httpx.Response(
            200,
            content=b"x" * 1000,
            headers={"content-disposition": "attachment; filename=test.bin"},
        )

        monkeypatch.setattr(
            dify_config,
            "HTTP_REQUEST_NODE_MAX_BINARY_SIZE",
            1,
        )

        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
            http_client=DummyHttpClient(response=response),
        )

        with pytest.raises(ResponseSizeError):
            executor.invoke()

    def test_http_max_retries_error(self):
        node = HttpRequestNodeData(
            title="t",
            method="get",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
            http_client=DummyHttpClient(raise_error=DummyHttpClient.MaxRetriesExceededError),
        )

        with pytest.raises(HttpRequestNodeError):
            executor.invoke()

    def test_to_log_json_body(self):
        node = HttpRequestNodeData(
            title="t",
            method="post",
            url="http://example.com",
            headers="",
            params="",
            authorization=HttpRequestNodeAuthorization(type="no-auth"),
            body=HttpRequestNodeBody(
                type="json",
                data=[BodyData(key="", type="text", value='{"a":1}')],
            ),
        )

        executor = Executor(
            node_data=node,
            timeout=HttpRequestNodeTimeout(connect=1, read=1, write=1),
            variable_pool=self.variable_pool,
        )

        log = executor.to_log()
        assert '{"a": 1}' in log
