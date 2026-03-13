from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.workflow.node_factory import DifyNodeFactory
from dify_graph.enums import NodeType


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


class DummyTemplateTransformNode(DummyNode):
    pass


class DummyHttpRequestNode(DummyNode):
    pass


class DummyKnowledgeRetrievalNode(DummyNode):
    pass


class DummyDocumentExtractorNode(DummyNode):
    pass


class TestDifyNodeFactory:
    def _factory(self, monkeypatch):
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MAX_STRING_LENGTH", 10)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MAX_NUMBER", 10)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MIN_NUMBER", -10)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MAX_PRECISION", 4)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MAX_DEPTH", 2)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH", 2)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MAX_STRING_ARRAY_LENGTH", 2)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH", 2)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.TEMPLATE_TRANSFORM_MAX_LENGTH", 100)
        monkeypatch.setattr("core.workflow.node_factory.dify_config.UNSTRUCTURED_API_URL", "http://u")
        monkeypatch.setattr("core.workflow.node_factory.dify_config.UNSTRUCTURED_API_KEY", "key")

        run_context = build_dify_run_context(
            tenant_id="tenant",
            app_id="app",
            user_id="user",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        return DifyNodeFactory(
            graph_init_params=SimpleNamespace(run_context=run_context),
            graph_runtime_state=SimpleNamespace(),
        )

    def test_create_node_unknown_type(self, monkeypatch):
        factory = self._factory(monkeypatch)

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": "unknown"}})

    def test_create_node_missing_mapping(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr("core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING", {})

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": NodeType.START.value}})

    def test_create_node_missing_latest_class(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr(
            "core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.START: {"1": None}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "latest")

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": NodeType.START.value}})

    def test_create_node_selects_versioned_class(self, monkeypatch):
        factory = self._factory(monkeypatch)

        monkeypatch.setattr(
            "core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.START: {"1": DummyNode, "2": DummyNode}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "1")

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.START.value, "version": "2"}})

        assert isinstance(node, DummyNode)
        assert node.id == "node-1"

    def test_create_node_code_branch(self, monkeypatch):
        factory = self._factory(monkeypatch)

        monkeypatch.setattr(
            "core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.CODE: {"1": DummyCodeNode}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "1")

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.CODE.value}})

        assert isinstance(node, DummyCodeNode)
        assert node.id == "node-1"

    def test_create_node_template_transform_branch(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr(
            "core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.TEMPLATE_TRANSFORM: {"1": DummyTemplateTransformNode}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "1")

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.TEMPLATE_TRANSFORM.value}})

        assert isinstance(node, DummyTemplateTransformNode)
        assert "template_renderer" in node.kwargs

    def test_create_node_http_request_branch(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr(
            "core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.HTTP_REQUEST: {"1": DummyHttpRequestNode}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "1")

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.HTTP_REQUEST.value}})

        assert isinstance(node, DummyHttpRequestNode)
        assert "http_request_config" in node.kwargs

    def test_create_node_knowledge_retrieval_branch(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr(
            "core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.KNOWLEDGE_RETRIEVAL: {"1": DummyKnowledgeRetrievalNode}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "1")

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.KNOWLEDGE_RETRIEVAL.value}})

        assert isinstance(node, DummyKnowledgeRetrievalNode)
        assert "rag_retrieval" in node.kwargs

    def test_create_node_document_extractor_branch(self, monkeypatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr(
            "core.workflow.node_factory.NODE_TYPE_CLASSES_MAPPING",
            {NodeType.DOCUMENT_EXTRACTOR: {"1": DummyDocumentExtractorNode}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "1")

        node = factory.create_node({"id": "node-1", "data": {"type": NodeType.DOCUMENT_EXTRACTOR.value}})

        assert isinstance(node, DummyDocumentExtractorNode)
        assert "unstructured_api_config" in node.kwargs
