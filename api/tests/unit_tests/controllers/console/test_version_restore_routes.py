"""Every Console route that restores or exports a published workflow version checks the workspace plan."""

import inspect
from collections.abc import Callable
from types import FunctionType

import pytest

from controllers.console.app.workflow import DraftWorkflowRestoreApi
from controllers.console.datasets.rag_pipeline.rag_pipeline_workflow import RagPipelineDraftWorkflowRestoreApi
from controllers.console.snippets.snippet_workflow import SnippetDraftWorkflowRestoreApi
from controllers.console.workspace import snippets as snippets_module


def _wrapper_names(view: Callable[..., object]) -> list[str]:
    names: list[str] = []
    current: object = view
    while isinstance(current, FunctionType):
        names.append(current.__code__.co_name)
        current = vars(current).get("__wrapped__")
    return names


@pytest.mark.parametrize(
    "resource",
    [DraftWorkflowRestoreApi, RagPipelineDraftWorkflowRestoreApi, SnippetDraftWorkflowRestoreApi],
)
def test_restore_routes_require_the_version_restore_plan(resource: type) -> None:
    names = _wrapper_names(resource.post)

    assert "version_restore_decorated" in names
    # The plan check runs after authentication and permission checks, right before the handler.
    assert names[-2] == "version_restore_decorated"


def test_snippet_version_export_checks_the_plan_only_for_a_specific_version() -> None:
    source = inspect.getsource(snippets_module.CustomizedSnippetExportApi.get)

    assert "if query.workflow_id:\n            require_version_restore(current_tenant_id)" in source
