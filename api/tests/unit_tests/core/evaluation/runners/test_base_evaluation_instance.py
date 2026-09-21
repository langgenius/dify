import pytest

from core.evaluation.base_evaluation_instance import resolve_variable_selector
from graphon.node_events import NodeRunResult


def test_resolve_variable_selector_rejects_missing_runtime_output() -> None:
    node_results = {"node_1": NodeRunResult(outputs={"text": "answer"})}

    with pytest.raises(ValueError, match="missing.*not found"):
        resolve_variable_selector("#node_1.missing#", node_results)
