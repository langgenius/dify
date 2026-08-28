from core.dify_builder.contract import RunStatus, SessionModel
from services.dify_builder.service import SessionView


def test_session_view_has_model_field_default_none():
    # A minimally-constructed view defaults model to None.
    view = SessionView(
        session_id="s", app_id="a", version=1, state="build.capability_check",
        canvas_read_only=False, run_status=RunStatus.WAITING_INPUT,
        interrupted=False, conversation=[],
    )
    assert view.model is None


def test_session_model_shape():
    m = SessionModel(provider="openai", name="gpt-4o")
    assert (m.provider, m.name) == ("openai", "gpt-4o")
