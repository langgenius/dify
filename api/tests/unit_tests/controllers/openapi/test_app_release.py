import pytest

from controllers.openapi.app_run import DRAFT_TEST_OPS
from models.model import AppMode


@pytest.mark.parametrize(
    ("mode", "op"),
    [
        (AppMode.WORKFLOW, "test.console_app.workflow"),
        (AppMode.ADVANCED_CHAT, "test.console_app.advanced_chat"),
    ],
)
def test_draft_test_hint_op_follows_mode(mode: AppMode, op: str) -> None:
    assert DRAFT_TEST_OPS[mode] == op
