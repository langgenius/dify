from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.workflow.node_factory import DifyNodeFactory
from graphon.enums import BuiltinNodeTypes


class DummyNode:
    def __init__(self, *, node_id, data, graph_init_params, graph_runtime_state, **kwargs):
        self.id = node_id
        self.data = data
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
    @staticmethod
    def _stub_node_resolution(monkeypatch, node_class):
        monkeypatch.setattr(
            "core.workflow.node_factory.resolve_workflow_node_class",
            lambda **_kwargs: node_class,
        )

    def _factory(self, monkeypatch: pytest.MonkeyPatch):
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

    def test_create_node_unknown_type(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": "unknown"}})

    def test_create_node_missing_mapping(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr("core.workflow.node_factory.get_node_type_classes_mapping", lambda: {})

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START}})

    def test_create_node_missing_latest_class(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        monkeypatch.setattr(
            "core.workflow.node_factory.get_node_type_classes_mapping",
            lambda: {BuiltinNodeTypes.START: {"1": None}},
        )
        monkeypatch.setattr("core.workflow.node_factory.LATEST_VERSION", "latest")

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START}})

    def test_create_node_selects_versioned_class(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        selected_versions: list[tuple[str, str]] = []

        class DummyNodeV2(DummyNode):
            pass

        def _get_mapping():
            selected_versions.append(("snapshot", "called"))
            return {BuiltinNodeTypes.START: {"1": DummyNode, "2": DummyNodeV2}}

        monkeypatch.setattr("core.workflow.node_factory.get_node_type_classes_mapping", _get_mapping)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START, "version": "2"}})

        assert isinstance(node, DummyNodeV2)
        assert node.id == "node-1"
        assert selected_versions == [("snapshot", "called")]

    def test_create_node_code_branch(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        self._stub_node_resolution(monkeypatch, DummyCodeNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.CODE}})

        assert isinstance(node, DummyCodeNode)
        assert node.id == "node-1"

    def test_create_node_template_transform_branch(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        self._stub_node_resolution(monkeypatch, DummyTemplateTransformNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.TEMPLATE_TRANSFORM}})

        assert isinstance(node, DummyTemplateTransformNode)
        assert "jinja2_template_renderer" in node.kwargs

    def test_create_node_http_request_branch(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        self._stub_node_resolution(monkeypatch, DummyHttpRequestNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.HTTP_REQUEST}})

        assert isinstance(node, DummyHttpRequestNode)
        assert "http_request_config" in node.kwargs

    def test_create_node_knowledge_retrieval_branch(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        self._stub_node_resolution(monkeypatch, DummyKnowledgeRetrievalNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}})

        assert isinstance(node, DummyKnowledgeRetrievalNode)
        assert node.kwargs == {}

    def test_create_node_document_extractor_branch(self, monkeypatch: pytest.MonkeyPatch):
        factory = self._factory(monkeypatch)
        self._stub_node_resolution(monkeypatch, DummyDocumentExtractorNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.DOCUMENT_EXTRACTOR}})

        assert isinstance(node, DummyDocumentExtractorNode)
        assert "unstructured_api_config" in node.kwargs
