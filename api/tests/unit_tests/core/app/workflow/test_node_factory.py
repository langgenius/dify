from types import SimpleNamespace

import pytest

from core.app.workflow.node_factory import DifyNodeFactory
from core.workflow.enums import NodeType


class DummyNode:
    def __init__(self, *, id, config, graph_init_params, graph_runtime_state, **kwargs):
        self.id = id
        self.config = config
        self.graph_init_params = graph_init_params
        self.graph_runtime_state = graph_runtime_state
        self.kwargs = kwargs


class DummyCodeNode(DummyNode):
    @classmethod
    def default_code_providers(cls):
        return ()


class TestDifyNodeFactory:
    def _factory(self, monkeypatch):
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MAX_STRING_LENGTH", 10)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MAX_NUMBER", 10)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MIN_NUMBER", -10)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MAX_PRECISION", 4)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MAX_DEPTH", 2)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH", 2)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MAX_STRING_ARRAY_LENGTH", 2)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH", 2)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.TEMPLATE_TRANSFORM_MAX_LENGTH", 100)
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.UNSTRUCTURED_API_URL", "http://u")
        monkeypatch.setattr("core.app.workflow.node_factory.dify_config.UNSTRUCTURED_API_KEY", "key")

        return DifyNodeFactory(
            graph_init_params=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

    def test_create_node_unknown_type(self, monkeypatch):
        factory = self._factory(monkeypatch)

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": "unknown"}})

    def test_create_node_missing_mapping(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr("core.app.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING", {})

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": NodeType.START.value}})

    def test_create_node_missing_latest_class(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr(
            "core.app.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.START: {"1": None}},
        )
        monkeypatch.setattr("core.app.workflow.node_factory.LATEST_VERSION", "latest")

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": NodeType.START.value}})

    def test_create_node_selects_versioned_class(self, monkeypatch):
        factory = self._factory(monkeypatch)

        monkeypatch.setattr(
            "core.app.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.START: {"1": DummyNode, "2": DummyNode}},
        )
        monkeypatch.setattr("core.app.workflow.node_factory.LATEST_VERSION", "1")

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.START.value, "version": "2"}})

        assert isinstance(node, DummyNode)
        assert node.id == "node-1"

    def test_create_node_code_branch(self, monkeypatch):
        factory = self._factory(monkeypatch)

        monkeypatch.setattr(
            "core.app.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.CODE: {"1": DummyNode}},
        )
        monkeypatch.setattr("core.app.workflow.node_factory.LATEST_VERSION", "1")
        monkeypatch.setattr("core.app.workflow.node_factory.CodeNode", DummyCodeNode)

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.CODE.value}})

        assert isinstance(node, DummyCodeNode)
        assert node.id == "node-1"
