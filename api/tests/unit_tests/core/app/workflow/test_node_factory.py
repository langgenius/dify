from collections.abc import Callable, Mapping

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from graphon.entities import GraphInitParams
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.runtime import GraphRuntimeState, VariablePool
from services.workflow.execution.adapters.node_factory import DifyNodeFactory
from services.workflow.execution.ports import WorkflowRuntime


class DummyNode:
    def __init__(
        self,
        *,
        node_id: str,
        data: dict[str, object],
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        **kwargs: object,
    ) -> None:
        self.id = node_id
        self.data = data
        self.graph_init_params = graph_init_params
        self.graph_runtime_state = graph_runtime_state
        self.kwargs = kwargs

    @classmethod
    def validate_node_data(cls, node_data: BaseNodeData | Mapping[str, object]) -> BaseNodeData:
        payload = node_data.model_dump(mode="python") if isinstance(node_data, BaseNodeData) else dict(node_data)
        return BaseNodeData.model_validate(payload)


class DummyCodeNode(DummyNode):
    @classmethod
    def default_code_providers(cls) -> tuple[()]:
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
    @pytest.fixture(autouse=True)
    def _node_config(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(
            CODE_MAX_STRING_LENGTH=10,
            CODE_MAX_NUMBER=10,
            CODE_MIN_NUMBER=-10,
            CODE_MAX_PRECISION=4,
            CODE_MAX_DEPTH=2,
            CODE_MAX_NUMBER_ARRAY_LENGTH=2,
            CODE_MAX_STRING_ARRAY_LENGTH=2,
            CODE_MAX_OBJECT_ARRAY_LENGTH=2,
            TEMPLATE_TRANSFORM_MAX_LENGTH=100,
            UNSTRUCTURED_API_URL="http://u",
            UNSTRUCTURED_API_KEY="key",
        )

    @staticmethod
    def _stub_node_resolution(monkeypatch: pytest.MonkeyPatch, node_class: type[DummyNode]) -> None:
        monkeypatch.setattr(
            "services.workflow.execution.adapters.node_factory.resolve_workflow_node_class",
            lambda **_kwargs: node_class,
        )

    def _factory(self) -> DifyNodeFactory:
        run_context = build_dify_run_context(
            tenant_id="tenant",
            app_id="app",
            user_id="user",
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.WEB_APP,
        )

        return DifyNodeFactory(
            graph_init_params=GraphInitParams(
                workflow_id="workflow-id",
                graph_config={},
                run_context=run_context,
                call_depth=0,
            ),
            graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
        )

    def test_create_node_unknown_type(self) -> None:
        factory = self._factory()

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": "unknown"}})

    def test_create_node_missing_mapping(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = self._factory()
        monkeypatch.setattr(
            "services.workflow.execution.adapters.node_factory.get_node_type_classes_mapping", lambda: {}
        )

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START}})

    def test_create_node_missing_latest_class(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = self._factory()
        monkeypatch.setattr(
            "services.workflow.execution.adapters.node_factory.get_node_type_classes_mapping",
            lambda: {BuiltinNodeTypes.START: {"1": None}},
        )
        monkeypatch.setattr("services.workflow.execution.adapters.node_factory.LATEST_VERSION", "latest")

        with pytest.raises(ValueError):
            factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START}})

    def test_create_node_selects_versioned_class(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = self._factory()
        selected_versions: list[tuple[str, str]] = []

        class DummyNodeV2(DummyNode):
            pass

        def _get_mapping() -> Mapping[NodeType, Mapping[str, type[DummyNode]]]:
            selected_versions.append(("snapshot", "called"))
            return {BuiltinNodeTypes.START: {"1": DummyNode, "2": DummyNodeV2}}

        monkeypatch.setattr(
            "services.workflow.execution.adapters.node_factory.get_node_type_classes_mapping", _get_mapping
        )

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.START, "version": "2"}})

        assert isinstance(node, DummyNodeV2)
        assert node.id == "node-1"
        assert selected_versions == [("snapshot", "called")]

    def test_create_node_code_branch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = self._factory()
        self._stub_node_resolution(monkeypatch, DummyCodeNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.CODE}})

        assert isinstance(node, DummyCodeNode)
        assert node.id == "node-1"

    def test_create_node_template_transform_branch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = self._factory()
        self._stub_node_resolution(monkeypatch, DummyTemplateTransformNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.TEMPLATE_TRANSFORM}})

        assert isinstance(node, DummyTemplateTransformNode)
        assert "jinja2_template_renderer" in node.kwargs

    def test_create_node_http_request_branch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = self._factory()
        self._stub_node_resolution(monkeypatch, DummyHttpRequestNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.HTTP_REQUEST}})

        assert isinstance(node, DummyHttpRequestNode)
        assert "http_request_config" in node.kwargs

    def test_create_node_knowledge_retrieval_branch(
        self, monkeypatch: pytest.MonkeyPatch, workflow_runtime: WorkflowRuntime
    ) -> None:
        factory = self._factory()
        factory._workflow_runtime = workflow_runtime
        self._stub_node_resolution(monkeypatch, DummyKnowledgeRetrievalNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}})

        assert isinstance(node, DummyKnowledgeRetrievalNode)
        assert "retrieval" in node.kwargs

    def test_create_node_document_extractor_branch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = self._factory()
        self._stub_node_resolution(monkeypatch, DummyDocumentExtractorNode)

        node = factory.create_node({"id": "node-1", "data": {"type": BuiltinNodeTypes.DOCUMENT_EXTRACTOR}})

        assert isinstance(node, DummyDocumentExtractorNode)
        assert "unstructured_api_config" in node.kwargs
