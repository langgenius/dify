from unittest.mock import MagicMock, PropertyMock, patch

import pytest

from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.http_request.entities import (
    HttpRequestNodeTimeout,
)
from core.workflow.nodes.http_request.exc import (
    HttpRequestNodeError,
    RequestBodyError,
)
from core.workflow.nodes.http_request.node import (
    HTTP_REQUEST_DEFAULT_TIMEOUT,
    HttpRequestNode,
    default_file_manager,
    ssrf_proxy,
)


@pytest.fixture
def node():
    """
    Fully isolated HttpRequestNode instance
    """
    with patch("core.workflow.nodes.http_request.node.Node.__init__", return_value=None):
        node = HttpRequestNode(
            id="node1",
            config={},
            graph_init_params=MagicMock(),
            graph_runtime_state=MagicMock(),
        )

        node.user_id = "user1"
        node.tenant_id = "tenant1"
        node.graph_runtime_state = MagicMock()
        node.graph_runtime_state.variable_pool = MagicMock()

        return node


class TestMetadata:
    def test_version(self):
        assert HttpRequestNode.version() == "1"

    def test_default_config(self):
        config = HttpRequestNode.get_default_config()
        assert config["type"] == "http-request"
        assert "config" in config
        assert "retry_config" in config


class TestTimeout:
    def test_timeout_none(self):
        node_data = MagicMock(timeout=None)
        result = HttpRequestNode._get_request_timeout(node_data)
        assert result == HTTP_REQUEST_DEFAULT_TIMEOUT

    def test_timeout_full(self):
        timeout = HttpRequestNodeTimeout(connect=1, read=2, write=3)
        node_data = MagicMock(timeout=timeout)

        result = HttpRequestNode._get_request_timeout(node_data)

        assert result.connect == 1
        assert result.read == 2
        assert result.write == 3


class TestRun:
    @patch("core.workflow.nodes.http_request.node.Executor")
    def test_success(self, mock_executor_cls, node):
        mock_executor = MagicMock()
        mock_executor.url = "http://test.com"
        mock_executor.to_log.return_value = {}
        mock_executor.invoke.return_value = MagicMock(
            response=MagicMock(is_success=True),
            status_code=200,
            text="ok",
            headers={},
            is_file=False,
        )
        mock_executor_cls.return_value = mock_executor

        with patch.object(
            HttpRequestNode,
            "node_data",
            new_callable=PropertyMock,
            return_value=MagicMock(
                timeout=None,
                retry_config=MagicMock(retry_enabled=True),
            ),
        ):
            result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["status_code"] == 200

    @patch("core.workflow.nodes.http_request.node.Executor")
    def test_failed_response(self, mock_executor_cls, node):
        mock_executor = MagicMock()
        mock_executor.url = "http://test.com"
        mock_executor.to_log.return_value = {}
        mock_executor.invoke.return_value = MagicMock(
            response=MagicMock(is_success=False),
            status_code=500,
            text="error",
            headers={},
            is_file=False,
        )
        mock_executor_cls.return_value = mock_executor

        # inject required internal attributes
        node._node_id = "node1"
        node._node_data = MagicMock(error_strategy=None)

        with patch.object(
            HttpRequestNode,
            "node_data",
            new_callable=PropertyMock,
            return_value=MagicMock(
                timeout=None,
                retry_config=MagicMock(retry_enabled=True),
            ),
        ):
            result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error_type == "HTTPResponseCodeError"

    @patch("core.workflow.nodes.http_request.node.Executor")
    def test_exception(self, mock_executor_cls, node):
        mock_executor = MagicMock()
        mock_executor.invoke.side_effect = HttpRequestNodeError("boom")
        mock_executor.to_log.return_value = {}
        mock_executor_cls.return_value = mock_executor

        # inject required internals
        node._node_id = "node1"
        node._node_data = MagicMock(error_strategy=None)

        with patch.object(
            HttpRequestNode,
            "node_data",
            new_callable=PropertyMock,
            return_value=MagicMock(
                timeout=None,
                retry_config=MagicMock(retry_enabled=True),
            ),
        ):
            result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error == "boom"


class TestVariableMapping:
    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_binary_invalid_length(self, mock_model):
        mock_body = MagicMock(type="binary", data=[MagicMock(), MagicMock()])
        mock_model.model_validate.return_value = MagicMock(
            url="",
            headers="",
            params="",
            body=mock_body,
        )

        with pytest.raises(RequestBodyError):
            HttpRequestNode._extract_variable_selector_to_variable_mapping(
                graph_config={},
                node_id="node1",
                node_data={},
            )

    @patch("core.workflow.nodes.http_request.node.variable_template_parser")
    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_json_body(self, mock_model, mock_parser):
        mock_parser.extract_selectors_from_template.return_value = []

        mock_body = MagicMock(type="json", data=[MagicMock(key="k", value="v")])
        mock_model.model_validate.return_value = MagicMock(
            url="",
            headers="",
            params="",
            body=mock_body,
        )

        mapping = HttpRequestNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )

        assert isinstance(mapping, dict)


class TestExtractFiles:
    def test_not_file(self, node):
        response = MagicMock(is_file=False)
        result = node.extract_files("http://x.com", response)
        assert result.value == []

    @patch("core.workflow.nodes.http_request.node.ArrayFileSegment")
    @patch("core.workflow.nodes.http_request.node.file_factory")
    def test_file_extraction(self, mock_factory, mock_array_segment, node):
        tool_file = MagicMock(id="file1")

        tool_manager = MagicMock()
        tool_manager.create_file_by_raw.return_value = tool_file
        node._tool_file_manager_factory = MagicMock(return_value=tool_manager)

        mock_factory.build_from_mapping.return_value = MagicMock()
        mock_array_segment.return_value = MagicMock(value=["file"])

        response = MagicMock(
            is_file=True,
            content_type="image/png",
            content=b"data",
            parsed_content_disposition=None,
        )

        result = node.extract_files("http://x.com/test.png", response)

        assert result.value == ["file"]


class TestRetry:
    def test_retry_enabled(self, node):
        with patch.object(
            HttpRequestNode,
            "node_data",
            new_callable=PropertyMock,
            return_value=MagicMock(retry_config=MagicMock(retry_enabled=True)),
        ):
            assert node.retry is True


class TestInitCoverage:
    def test_default_dependency_wiring(self):
        with patch("core.workflow.nodes.http_request.node.Node.__init__", return_value=None):
            node = HttpRequestNode(
                id="n1",
                config={},
                graph_init_params=MagicMock(),
                graph_runtime_state=MagicMock(),
            )

            assert node._http_client == ssrf_proxy
            assert node._file_manager == default_file_manager


class TestBodyTypeBranches:
    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_body_none_branch(self, mock_model):
        mock_model.model_validate.return_value = MagicMock(
            url="",
            headers="",
            params="",
            body=MagicMock(type="none", data=[]),
        )

        result = HttpRequestNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )

        assert result == {}

    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_binary_valid_branch(self, mock_model):
        file_selector = ["var", "file"]

        mock_body = MagicMock(
            type="binary",
            data=[MagicMock(file=file_selector)],
        )

        mock_model.model_validate.return_value = MagicMock(
            url="",
            headers="",
            params="",
            body=mock_body,
        )

        result = HttpRequestNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )

        assert "node1.#var.file#" in result

    @patch("core.workflow.nodes.http_request.node.variable_template_parser")
    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_raw_text_branch(self, mock_model, mock_parser):
        mock_parser.extract_selectors_from_template.return_value = []
        mock_body = MagicMock(
            type="raw-text",
            data=[MagicMock(key="k", value="v")],
        )
        mock_model.model_validate.return_value = MagicMock(
            url="",
            headers="",
            params="",
            body=mock_body,
        )
        result = HttpRequestNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )
        assert isinstance(result, dict)

    @patch("core.workflow.nodes.http_request.node.variable_template_parser")
    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_form_urlencoded_branch(self, mock_model, mock_parser):
        mock_parser.extract_selectors_from_template.return_value = []

        mock_body = MagicMock(
            type="x-www-form-urlencoded",
            data=[MagicMock(key="k1", value="v1")],
        )
        mock_model.model_validate.return_value = MagicMock(
            url="",
            headers="",
            params="",
            body=mock_body,
        )
        result = HttpRequestNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )
        assert isinstance(result, dict)

    @patch("core.workflow.nodes.http_request.node.variable_template_parser")
    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_form_data_file_branch(self, mock_model, mock_parser):
        mock_parser.extract_selectors_from_template.return_value = []
        mock_body = MagicMock(
            type="form-data",
            data=[
                MagicMock(type="file", key="k", file=["a", "b"]),
            ],
        )
        mock_model.model_validate.return_value = MagicMock(
            url="",
            headers="",
            params="",
            body=mock_body,
        )
        result = HttpRequestNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )
        assert "node1.#a.b#" in result

    @patch("core.workflow.nodes.http_request.node.variable_template_parser")
    @patch("core.workflow.nodes.http_request.node.HttpRequestNodeData")
    def test_selector_mapping_loop(self, mock_model, mock_parser):
        selector = VariableSelector(
            variable="#var#",
            value_selector=["var"],
        )

        mock_parser.extract_selectors_from_template.return_value = [selector]

        mock_model.model_validate.return_value = MagicMock(
            url="test",
            headers="",
            params="",
            body=None,
        )

        result = HttpRequestNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data={},
        )

        assert "node1.#var#" in result


class TestContentDispositionBranch:
    @patch("core.workflow.nodes.http_request.node.ArrayFileSegment")
    @patch("core.workflow.nodes.http_request.node.file_factory")
    def test_content_disposition_filename(
        self,
        mock_factory,
        mock_array_segment,
        node,
    ):
        tool_file = MagicMock(id="file1")

        tool_manager = MagicMock()
        tool_manager.create_file_by_raw.return_value = tool_file
        node._tool_file_manager_factory = MagicMock(return_value=tool_manager)

        mock_factory.build_from_mapping.return_value = MagicMock()
        mock_array_segment.return_value = MagicMock(value=["file"])

        parsed_cd = MagicMock()
        parsed_cd.get_filename.return_value = "image.png"

        response = MagicMock(
            is_file=True,
            content_type=None,
            content=b"data",
            parsed_content_disposition=parsed_cd,
        )

        result = node.extract_files("http://x.com/test", response)

        assert result.value == ["file"]
