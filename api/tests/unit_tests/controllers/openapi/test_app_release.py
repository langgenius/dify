import pytest

from controllers.openapi.app_run import draft_test_hint
from models.model import AppMode


@pytest.mark.parametrize(
    ("mode", "op", "expected"),
    [
        (AppMode.WORKFLOW, "test.console_app.workflow", {"app_id": "app-1"}),
        (AppMode.ADVANCED_CHAT, "test.console_app.advanced_chat", {"app_id": "app-1", "query": None}),
    ],
)
def test_draft_test_hint_follows_mode_and_names_its_required_fields(
    mode: AppMode, op: str, expected: dict[str, object]
) -> None:
    hint = draft_test_hint(mode, app_id="app-1", summary="Test it")

    assert (hint.op, hint.input) == (op, expected)
