from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.datasource.entities.datasource_entities import DatasourceMessage
from core.workflow.node_events import StreamChunkEvent, StreamCompletedEvent
from core.workflow.nodes.datasource.datasource_node import DatasourceNode
from core.workflow.nodes.datasource.exc import DatasourceParameterError


class DummySegment:
    def __init__(self, value):
        self.value = value


class DummyTemplate:
    def __init__(self, text):
        self.text = text
        self.log = f"log-{text}"


class TestDatasourceNode:
    @pytest.fixture
    def node(self):
        node = DatasourceNode.__new__(DatasourceNode)
        node._node_id = "node1"
        node.user_id = "user1"
        node.tenant_id = "tenant1"
        return node

    @pytest.fixture
    def variable_pool(self):
        pool = MagicMock()
        pool.get.return_value = DummySegment("value1")
        pool.convert_template.return_value = DummyTemplate("converted")
        return pool

    def test_generate_parameters_variable(self, node, variable_pool):
        parameter = SimpleNamespace(name="p1")
        node_data = SimpleNamespace(datasource_parameters={"p1": SimpleNamespace(type="variable", value=["x"])})
        result = node._generate_parameters(
            datasource_parameters=[parameter],
            variable_pool=variable_pool,
            node_data=node_data,
        )
        assert result["p1"] == "value1"

    def test_generate_parameters_variable_not_found(self, node, variable_pool):
        variable_pool.get.return_value = None
        parameter = SimpleNamespace(name="p1")
        node_data = SimpleNamespace(datasource_parameters={"p1": SimpleNamespace(type="variable", value=["x"])})
        with pytest.raises(DatasourceParameterError):
            node._generate_parameters(
                datasource_parameters=[parameter],
                variable_pool=variable_pool,
                node_data=node_data,
            )

    def test_generate_parameters_mixed(self, node, variable_pool):
        parameter = SimpleNamespace(name="p1")
        node_data = SimpleNamespace(datasource_parameters={"p1": SimpleNamespace(type="mixed", value="abc")})
        result = node._generate_parameters(
            datasource_parameters=[parameter],
            variable_pool=variable_pool,
            node_data=node_data,
        )
        assert result["p1"] == "converted"

    def test_generate_parameters_mixed_for_log(self, node, variable_pool):
        parameter = SimpleNamespace(name="p1")
        node_data = SimpleNamespace(datasource_parameters={"p1": SimpleNamespace(type="mixed", value="abc")})
        result = node._generate_parameters(
            datasource_parameters=[parameter],
            variable_pool=variable_pool,
            node_data=node_data,
            for_log=True,
        )
        assert result["p1"] == "log-converted"

    def test_generate_parameters_constant(self, node, variable_pool):
        parameter = SimpleNamespace(name="p1")
        node_data = SimpleNamespace(datasource_parameters={"p1": SimpleNamespace(type="constant", value="abc")})
        result = node._generate_parameters(
            datasource_parameters=[parameter],
            variable_pool=variable_pool,
            node_data=node_data,
        )
        assert result["p1"] == "converted"

    def test_generate_parameters_unknown_type(self, node, variable_pool):
        parameter = SimpleNamespace(name="p1")
        node_data = SimpleNamespace(datasource_parameters={"p1": SimpleNamespace(type="invalid", value="abc")})
        with pytest.raises(DatasourceParameterError):
            node._generate_parameters(
                datasource_parameters=[parameter],
                variable_pool=variable_pool,
                node_data=node_data,
            )

    @patch("core.workflow.nodes.datasource.datasource_node.ArrayAnyVariable", new=object)
    @patch("core.workflow.nodes.datasource.datasource_node.ArrayAnySegment", new=object)
    def test_fetch_files(self, node):
        class Dummy:
            value = [1, 2]

        pool = MagicMock()
        pool.get.return_value = Dummy()

        result = node._fetch_files(pool)

        assert result == [1, 2]

    @patch("core.workflow.nodes.datasource.datasource_node.VariableTemplateParser")
    def test_extract_variable_selector_mixed(self, parser_mock):
        parser_instance = MagicMock()
        parser_instance.extract_variable_selectors.return_value = [SimpleNamespace(variable="v1", value_selector=["x"])]
        parser_mock.return_value = parser_instance

        node_data = {
            "plugin_id": "p",
            "provider_name": "prov",
            "provider_type": "ONLINE_DOCUMENT",
            "title": "title",
            "datasource_name": "ds",
            "datasource_parameters": {"p1": {"type": "mixed", "value": "{{v1}}"}},
        }

        result = DatasourceNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data=node_data,
        )

        assert result["node1.v1"] == ["x"]

    def test_version(self):
        assert DatasourceNode.version() == "1"

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_message_text(self, transformer_mock, node):
        text_msg = DatasourceMessage.TextMessage(text="hello")

        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.TEXT,
            message=text_msg,
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        result = list(node._transform_message(iter([]), {}, {}))

        assert any(isinstance(e, StreamCompletedEvent) for e in result)

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_message_variable_stream(self, transformer_mock, node):
        var_msg = DatasourceMessage.VariableMessage(
            variable_name="v1",
            variable_value="chunk",
            stream=True,
        )

        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.VARIABLE,
            message=var_msg,
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        result = list(node._transform_message(iter([]), {}, {}))

        assert any(isinstance(e, StreamChunkEvent) for e in result)

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_message_json(self, transformer_mock, node):
        json_msg = DatasourceMessage.JsonMessage(json_object={"a": 1})

        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.JSON,
            message=json_msg,
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        result = list(node._transform_message(iter([]), {}, {}))

        assert any(isinstance(e, StreamCompletedEvent) for e in result)

    @patch("core.workflow.nodes.datasource.datasource_node.db")
    @patch("core.workflow.nodes.datasource.datasource_node.Session")
    @patch("core.workflow.nodes.datasource.datasource_node.file_factory")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_datasource_file_message(
        self,
        transformer_mock,
        file_factory_mock,
        session_mock,
        db_mock,
        node,
    ):
        db_mock.engine = MagicMock()

        session_instance = MagicMock()
        session_instance.scalar.return_value = SimpleNamespace(mimetype="text/plain")
        session_mock.return_value.__enter__.return_value = session_instance

        file_factory_mock.get_file_type_by_mime_type.return_value = "txt"
        file_factory_mock.build_from_mapping.return_value = MagicMock()

        text_msg = DatasourceMessage.TextMessage(text="http://x/123.txt")

        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.BINARY_LINK,
            message=text_msg,
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        pool = MagicMock()

        result = list(
            node._transform_datasource_file_message(
                iter([]),
                {},
                {},
                pool,
                "TYPE",
            )
        )

        assert any(isinstance(e, StreamCompletedEvent) for e in result)
        pool.add.assert_called()

    def test_generate_parameters_parameter_not_in_schema(self, node, variable_pool):
        parameter = SimpleNamespace(name="p1")

        node_data = SimpleNamespace(
            datasource_parameters={"missing_param": SimpleNamespace(type="variable", value=["x"])}
        )

        result = node._generate_parameters(
            datasource_parameters=[parameter],
            variable_pool=variable_pool,
            node_data=node_data,
        )

        assert result["missing_param"] is None

    def test_extract_variable_selector_variable_type(self):
        node_data = {
            "plugin_id": "p",
            "provider_name": "prov",
            "provider_type": "ONLINE_DOCUMENT",
            "title": "title",
            "datasource_parameters": {"p1": {"type": "variable", "value": ["a", "b"]}},
        }

        result = DatasourceNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data=node_data,
        )

        assert result["node1.p1"] == ["a", "b"]

    def test_extract_variable_selector_constant(self):
        node_data = {
            "plugin_id": "p",
            "provider_name": "prov",
            "provider_type": "ONLINE_DOCUMENT",
            "title": "title",
            "datasource_parameters": {"p1": {"type": "constant", "value": "abc"}},
        }

        result = DatasourceNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id="node1",
            node_data=node_data,
        )

        assert result == {}

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_message_link(self, transformer_mock, node):
        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.LINK,
            message=DatasourceMessage.TextMessage(text="http://example.com"),
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        result = list(node._transform_message(iter([]), {}, {}))

        assert any(isinstance(e, StreamChunkEvent) for e in result)

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_message_variable_non_stream(self, transformer_mock, node):
        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.VARIABLE,
            message=DatasourceMessage.VariableMessage(
                variable_name="v1",
                variable_value="final_value",
                stream=False,
            ),
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        result = list(node._transform_message(iter([]), {}, {}))

        completed = next(e for e in result if isinstance(e, StreamCompletedEvent))
        assert completed.node_run_result.outputs["v1"] == "final_value"

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_message_file(self, transformer_mock, node):
        dummy_file = MagicMock()

        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.FILE,
            meta={"file": dummy_file},
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        result = list(node._transform_message(iter([]), {}, {}))

        assert any(isinstance(e, StreamCompletedEvent) for e in result)

    @patch("core.workflow.nodes.datasource.datasource_node.db")
    @patch("core.workflow.nodes.datasource.datasource_node.Session")
    @patch("core.workflow.nodes.datasource.datasource_node.file_factory")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_message_image_link(
        self,
        transformer_mock,
        file_factory_mock,
        session_mock,
        db_mock,
        node,
    ):
        db_mock.engine = MagicMock()

        session_instance = MagicMock()
        session_instance.scalar.return_value = SimpleNamespace(mimetype="text/plain")
        session_mock.return_value.__enter__.return_value = session_instance

        file_factory_mock.get_file_type_by_mime_type.return_value = "txt"
        file_factory_mock.build_from_mapping.return_value = MagicMock()

        message = SimpleNamespace(
            type=DatasourceMessage.MessageType.IMAGE_LINK,
            message=DatasourceMessage.TextMessage(text="http://x/123.txt"),
        )

        transformer_mock.transform_datasource_invoke_messages.return_value = [message]

        result = list(node._transform_message(iter([]), {}, {}))

        assert any(isinstance(e, StreamCompletedEvent) for e in result)

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceFileMessageTransformer")
    def test_transform_datasource_file_message_no_file(self, transformer_mock, node):
        transformer_mock.transform_datasource_invoke_messages.return_value = []

        pool = MagicMock()

        result = list(
            node._transform_datasource_file_message(
                iter([]),
                {},
                {},
                pool,
                "TYPE",
            )
        )

        assert any(isinstance(e, StreamCompletedEvent) for e in result)
        pool.add.assert_not_called()

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderService")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderType")
    @patch("core.datasource.datasource_manager.DatasourceManager")
    def test_run_website_crawl(
        self,
        manager_mock,
        provider_type_mock,
        service_mock,
        node,
    ):
        provider_type_mock.value_of.return_value = provider_type_mock.WEBSITE_CRAWL
        provider_type_mock.WEBSITE_CRAWL = "WEBSITE_CRAWL"

        service_instance = MagicMock()
        service_instance.get_datasource_credentials.return_value = None
        service_mock.return_value = service_instance

        node._node_data = SimpleNamespace(
            plugin_id="p",
            provider_name="prov",
            datasource_name="ds",
        )

        runtime_mock = MagicMock()
        runtime_mock.get_icon_url.return_value = "icon"
        manager_mock.get_datasource_runtime.return_value = runtime_mock

        variable_pool = MagicMock()
        variable_pool.get.side_effect = [
            DummySegment("anything"),
            DummySegment({"a": 1}),
        ]

        node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)

        result = list(node._run())

        assert any(isinstance(e, StreamCompletedEvent) for e in result)

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderService")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderType")
    @patch("core.datasource.datasource_manager.DatasourceManager")
    def test_run_unsupported_provider(
        self,
        manager_mock,
        provider_type_mock,
        service_mock,
        node,
    ):
        provider_type_mock.value_of.return_value = "UNSUPPORTED"

        service_instance = MagicMock()
        service_instance.get_datasource_credentials.return_value = None
        service_mock.return_value = service_instance

        node._node_data = SimpleNamespace(
            plugin_id="p",
            provider_name="prov",
            datasource_name="ds",
        )

        runtime_mock = MagicMock()
        runtime_mock.get_icon_url.return_value = "icon"
        manager_mock.get_datasource_runtime.return_value = runtime_mock

        variable_pool = MagicMock()
        variable_pool.get.side_effect = [
            DummySegment("anything"),
            DummySegment({"a": 1}),
        ]

        node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)

        result = list(node._run())

        completed = next(e for e in result if isinstance(e, StreamCompletedEvent))
        assert completed.node_run_result.status.name == "FAILED"

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderService")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderType")
    @patch("core.datasource.datasource_manager.DatasourceManager")
    def test_run_plugin_daemon_error(
        self,
        manager_mock,
        provider_type_mock,
        service_mock,
        node,
    ):
        from core.plugin.impl.exc import PluginDaemonClientSideError

        provider_type_mock.value_of.return_value = provider_type_mock.ONLINE_DOCUMENT
        provider_type_mock.ONLINE_DOCUMENT = "ONLINE_DOCUMENT"

        service_instance = MagicMock()
        service_instance.get_datasource_credentials.return_value = None
        service_mock.return_value = service_instance

        runtime_mock = MagicMock()
        runtime_mock.get_icon_url.return_value = "icon"
        runtime_mock.get_online_document_page_content.side_effect = PluginDaemonClientSideError("fail")

        manager_mock.get_datasource_runtime.return_value = runtime_mock

        node._node_data = SimpleNamespace(
            plugin_id="p",
            provider_name="prov",
            datasource_name="ds",
        )

        variable_pool = MagicMock()
        variable_pool.get.side_effect = [
            DummySegment("anything"),
            DummySegment({"workspace_id": "w", "page": {"page_id": "p1", "type": "doc"}}),
        ]

        node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)

        result = list(node._run())

        completed = next(e for e in result if isinstance(e, StreamCompletedEvent))
        assert completed.node_run_result.status.name == "FAILED"

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderService")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderType")
    @patch("core.datasource.datasource_manager.DatasourceManager")
    def test_run_datasource_node_error(
        self,
        manager_mock,
        provider_type_mock,
        service_mock,
        node,
    ):
        from core.workflow.nodes.datasource.exc import DatasourceNodeError

        provider_type_mock.value_of.return_value = provider_type_mock.ONLINE_DOCUMENT
        provider_type_mock.ONLINE_DOCUMENT = "ONLINE_DOCUMENT"

        service_instance = MagicMock()
        service_instance.get_datasource_credentials.return_value = None
        service_mock.return_value = service_instance

        runtime_mock = MagicMock()
        runtime_mock.get_icon_url.return_value = "icon"
        runtime_mock.get_online_document_page_content.side_effect = DatasourceNodeError("fail")

        manager_mock.get_datasource_runtime.return_value = runtime_mock

        node._node_data = SimpleNamespace(
            plugin_id="p",
            provider_name="prov",
            datasource_name="ds",
        )

        variable_pool = MagicMock()
        variable_pool.get.side_effect = [
            DummySegment("anything"),
            DummySegment({"workspace_id": "w", "page": {"page_id": "p1", "type": "doc"}}),
        ]

        node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)

        result = list(node._run())

        completed = next(e for e in result if isinstance(e, StreamCompletedEvent))
        assert completed.node_run_result.status.name == "FAILED"

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderService")
    @patch("core.datasource.datasource_manager.DatasourceManager")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderType.value_of")
    def test_run_online_document(
        self,
        value_of_mock,
        manager_mock,
        service_mock,
        node,
    ):
        from core.datasource.entities.datasource_entities import DatasourceProviderType

        value_of_mock.return_value = DatasourceProviderType.ONLINE_DOCUMENT

        service_instance = MagicMock()
        service_instance.get_datasource_credentials.return_value = {"token": "abc"}
        service_mock.return_value = service_instance

        runtime_mock = MagicMock()
        runtime_mock.get_icon_url.return_value = "icon"
        runtime_mock.get_online_document_page_content.return_value = iter([MagicMock()])

        manager_mock.get_datasource_runtime.return_value = runtime_mock

        node._node_data = SimpleNamespace(
            plugin_id="p",
            provider_name="prov",
            datasource_name="ds",
        )

        variable_pool = MagicMock()
        variable_pool.get.side_effect = [
            DummySegment("anything"),
            DummySegment({"workspace_id": "w", "page": {"page_id": "p1", "type": "doc"}}),
        ]

        node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)

        with patch.object(node, "_transform_message", return_value=iter(["done"])) as transform_mock:
            result = list(node._run())

        assert transform_mock.called
        assert result == ["done"]

    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderService")
    @patch("core.datasource.datasource_manager.DatasourceManager")
    @patch("core.workflow.nodes.datasource.datasource_node.DatasourceProviderType.value_of")
    def test_run_online_drive(
        self,
        value_of_mock,
        manager_mock,
        service_mock,
        node,
    ):
        from core.datasource.entities.datasource_entities import DatasourceProviderType

        value_of_mock.return_value = DatasourceProviderType.ONLINE_DRIVE

        service_instance = MagicMock()
        service_instance.get_datasource_credentials.return_value = {"token": "abc"}
        service_mock.return_value = service_instance

        runtime_mock = MagicMock()
        runtime_mock.get_icon_url.return_value = "icon"
        runtime_mock.online_drive_download_file.return_value = iter([MagicMock()])

        manager_mock.get_datasource_runtime.return_value = runtime_mock

        node._node_data = SimpleNamespace(
            plugin_id="p",
            provider_name="prov",
            datasource_name="ds",
        )

        variable_pool = MagicMock()
        variable_pool.get.side_effect = [
            DummySegment("anything"),
            DummySegment({"id": "file1", "bucket": "b"}),
        ]

        node.graph_runtime_state = SimpleNamespace(variable_pool=variable_pool)

        with patch.object(node, "_transform_datasource_file_message", return_value=iter(["done"])) as transform_mock:
            result = list(node._run())

        assert transform_mock.called
        assert result == ["done"]
