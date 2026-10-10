from dataclasses import asdict

import pytest

from controllers.openapi._models import DraftChanges
from controllers.openapi.app_release import _DRAFT_TEST_OPS
from models.model import AppMode
from services.workflow.graph_diff import WorkflowSnapshot, diff_workflows


def test_draft_changes_wire_shape() -> None:
    draft = WorkflowSnapshot(
        graph={"nodes": [{"id": "a", "data": {"type": "end", "title": "E"}}]},
        features={},
        environment_variable_names=frozenset(),
    )
    changes = DraftChanges.model_validate(asdict(diff_workflows(None, draft)))
    assert changes.published is False
    assert changes.nodes_added[0].id == "a"


@pytest.mark.parametrize(
    ("mode", "op"),
    [
        (AppMode.WORKFLOW, "test.console_app.workflow"),
        (AppMode.ADVANCED_CHAT, "test.console_app.advanced_chat"),
    ],
)
def test_draft_test_hint_op_follows_mode(mode: AppMode, op: str) -> None:
    assert _DRAFT_TEST_OPS[mode] == op
