from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest

from core.app.apps.completion.runtime_workflow_builder import build_runtime_completion_workflow
from models.model import App, AppMode
from services.workflow.workflow_converter import WorkflowConverter, WorkflowGraph


def test_builder_returns_runtime_graph_without_persisting_workflow(monkeypatch: pytest.MonkeyPatch) -> None:
    app_model = cast(App, SimpleNamespace(mode=AppMode.COMPLETION))
    app_config = MagicMock()
    graph: WorkflowGraph = {"nodes": [{"id": "start", "position": None, "data": {}}], "edges": []}
    build_graph = MagicMock(return_value=(graph, {}))
    monkeypatch.setattr(WorkflowConverter, "build_graph_from_app_config", build_graph)
    session = MagicMock()

    result = build_runtime_completion_workflow(
        app_model=app_model,
        app_config=app_config,
        session=session,
    )

    assert result is graph
    build_graph.assert_called_once_with(
        app_model=app_model,
        app_config=app_config,
        target_app_mode=AppMode.WORKFLOW,
        session=session,
        use_sys_query_for_external_data=True,
    )
