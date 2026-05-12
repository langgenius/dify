import pytest
from werkzeug.exceptions import InternalServerError

from controllers.openapi.app_run import (
    _DISPATCH,
    AppRunRequest,
    _unpack_blocking,
)
from models.model import AppMode


def test_dispatch_covers_runnable_modes():
    runnable = {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW}
    assert set(_DISPATCH) == runnable


def test_unpack_blocking_passes_through_mapping():
    assert _unpack_blocking({"a": 1}) == {"a": 1}


def test_unpack_blocking_unwraps_tuple():
    assert _unpack_blocking(({"a": 1}, 200)) == {"a": 1}


def test_unpack_blocking_rejects_non_mapping():
    with pytest.raises(InternalServerError):
        _unpack_blocking("not a mapping")


def test_app_run_request_strips_blank_conversation_id():
    payload = AppRunRequest(inputs={}, conversation_id="   ")
    assert payload.conversation_id is None


def test_app_run_request_rejects_invalid_uuid_conversation_id():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="conversation_id must be a valid UUID"):
        AppRunRequest(inputs={}, conversation_id="not-a-uuid")


def test_app_run_request_accepts_valid_uuid_conversation_id():
    import uuid as _uuid

    cid = str(_uuid.uuid4())
    payload = AppRunRequest(inputs={}, conversation_id=cid)
    assert payload.conversation_id == cid
