import importlib
import json
import types
from unittest.mock import MagicMock, patch

import pytest

from core.workflow.file_reference import build_file_reference
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod
from models.enums import CreatorUserRole
from models.model import Conversation, Message, MessageAgentThought


@pytest.fixture(autouse=True)
def patch_file_helpers(monkeypatch: pytest.MonkeyPatch):
    """
    Patch file_helpers.get_signed_file_url to a deterministic stub.
    """
    model_module = importlib.import_module("models.model")
    dummy = types.SimpleNamespace(get_signed_file_url=lambda fid: f"https://signed.example/{fid}")
    # Inject/override file_helpers on models.model
    monkeypatch.setattr(model_module, "file_helpers", dummy, raising=False)


def _wrap_md(url: str) -> str:
    """
    Wrap a raw URL into the markdown that re_sign_file_url_answer expects:
    [link](<url>)
    """
    return f"please click [file]({url}) to download."


def test_file_preview_valid_replaced():
    """
    Valid file-preview URL must be re-signed:
    - Extract upload_file_id correctly
    - Replace the original URL with the signed URL
    """
    upload_id = "abc-123"
    url = f"/files/{upload_id}/file-preview?timestamp=111&nonce=222&sign=333"
    msg = Message(answer=_wrap_md(url))

    out = msg.re_sign_file_url_answer
    assert f"https://signed.example/{upload_id}" in out
    assert url not in out


def test_file_preview_misspelled_not_replaced():
    """
    Misspelled endpoint 'file-previe?timestamp=' should NOT be rewritten.
    """
    upload_id = "zzz-001"
    # path deliberately misspelled: file-previe? (missing 'w')
    # and we append &note=file-preview to trick the old `"file-preview" in url` check.
    url = f"/files/{upload_id}/file-previe?timestamp=111&nonce=222&sign=333&note=file-preview"
    original = _wrap_md(url)
    msg = Message(answer=original)

    out = msg.re_sign_file_url_answer
    # Expect NO replacement, should not rewrite misspelled file-previe URL
    assert out == original


def test_image_preview_valid_replaced():
    """
    Valid image-preview URL must be re-signed.
    """
    upload_id = "img-789"
    url = f"/files/{upload_id}/image-preview?timestamp=123&nonce=456&sign=789"
    msg = Message(answer=_wrap_md(url))

    out = msg.re_sign_file_url_answer
    assert f"https://signed.example/{upload_id}" in out
    assert url not in out


def test_image_preview_misspelled_not_replaced():
    """
    Misspelled endpoint 'image-previe?timestamp=' should NOT be rewritten.
    """
    upload_id = "img-err-42"
    url = f"/files/{upload_id}/image-previe?timestamp=1&nonce=2&sign=3&note=image-preview"
    original = _wrap_md(url)
    msg = Message(answer=original)

    out = msg.re_sign_file_url_answer
    # Expect NO replacement, should not rewrite misspelled image-previe URL
    assert out == original


def _build_local_file_mapping(record_id: str, *, tenant_id: str | None = None) -> dict[str, object]:
    mapping: dict[str, object] = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": FileTransferMethod.LOCAL_FILE,
        "reference": build_file_reference(record_id=record_id),
        "type": "document",
        "filename": "example.txt",
        "extension": ".txt",
        "mime_type": "text/plain",
        "size": 1,
    }
    if tenant_id is not None:
        mapping["tenant_id"] = tenant_id
    return mapping


@pytest.mark.parametrize("owner_cls", [Conversation, Message])
def test_inputs_restore_external_remote_url_file_mappings(owner_cls: type[Conversation] | type[Message]) -> None:
    owner = owner_cls(app_id="app-1")
    owner.inputs = {
        "file": {
            "dify_model_identity": FILE_MODEL_IDENTITY,
            "transfer_method": FileTransferMethod.REMOTE_URL,
            "type": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "extension": ".pdf",
            "mime_type": "application/pdf",
            "size": 1,
        }
    }

    restored_file = owner.inputs["file"]

    assert restored_file.transfer_method == FileTransferMethod.REMOTE_URL
    assert restored_file.remote_url == "https://example.com/report.pdf"


def test_message_inputs_resolve_file_tenant_with_caller_session() -> None:
    message = Message(app_id="app-1")
    message.inputs = {"file": _build_local_file_mapping("upload-1")}
    session = MagicMock()
    session.scalar.return_value = "tenant-1"

    with patch(
        "models.model.build_file_from_input_mapping",
        side_effect=lambda **kwargs: kwargs["tenant_resolver"](),
    ):
        inputs = message.inputs_with_session(session=session)

    assert inputs["file"] == "tenant-1"
    session.scalar.assert_called_once()


# ==========================================================
# MessageAgentThought — one payload per call, in call order
# ==========================================================


def _agent_thought(*, tool: str, tool_input: str, observation: str, tool_meta_str: str) -> MessageAgentThought:
    return MessageAgentThought(
        message_id="message-1",
        position=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        tool=tool,
        tool_input=tool_input,
        observation=observation,
        tool_meta_str=tool_meta_str,
    )


# the four shapes an agent log can be built from: a record written before
# repeated calls were kept apart, and one written after, each with the tool
# called once and called twice. The legacy pair are written as literals — they
# are rows that exist and cannot be migrated.
LEGACY_SINGLE = _agent_thought(
    tool="search",
    tool_input=json.dumps({"search": {"q": "only"}}),
    observation=json.dumps({"search": "only result"}),
    tool_meta_str=json.dumps({"search": {"time_cost": 1}}),
)
LEGACY_REPEATED = _agent_thought(
    tool="search;search",
    tool_input=json.dumps({"search": {"q": "second"}}),
    observation=json.dumps({"search": "second result"}),
    tool_meta_str=json.dumps({"search": {"time_cost": 2}}),
)
NEW_SINGLE = _agent_thought(
    tool="search",
    tool_input=json.dumps({"search": {"q": "only"}}),
    observation=json.dumps({"search": "only result"}),
    tool_meta_str=json.dumps({"search": {"time_cost": 1}}),
)
NEW_REPEATED = _agent_thought(
    tool="search;search",
    tool_input=json.dumps({"search": [{"q": "first"}, {"q": "second"}]}),
    observation=json.dumps({"search": ["first result", "second result"]}),
    tool_meta_str=json.dumps({"search": [{"time_cost": 1}, {"time_cost": 2}]}),
)


def test_legacy_single_call_reads_one_value_per_payload():
    assert LEGACY_SINGLE.tool_inputs_per_call == [{"q": "only"}]
    assert LEGACY_SINGLE.tool_outputs_per_call == ["only result"]
    assert LEGACY_SINGLE.tool_metas_per_call == [{"time_cost": 1}]


def test_legacy_repeated_call_replays_the_surviving_value_for_each_call():
    # the row only ever held one call's data; both entries show it, exactly as
    # they do without this change
    assert LEGACY_REPEATED.tool_inputs_per_call == [{"q": "second"}, {"q": "second"}]
    assert LEGACY_REPEATED.tool_outputs_per_call == ["second result", "second result"]
    assert LEGACY_REPEATED.tool_metas_per_call == [{"time_cost": 2}, {"time_cost": 2}]


def test_new_single_call_reads_identically_to_a_legacy_single_call():
    assert NEW_SINGLE.tool_inputs_per_call == LEGACY_SINGLE.tool_inputs_per_call
    assert NEW_SINGLE.tool_outputs_per_call == LEGACY_SINGLE.tool_outputs_per_call
    assert NEW_SINGLE.tool_metas_per_call == LEGACY_SINGLE.tool_metas_per_call


def test_new_repeated_call_reads_each_call_separately():
    assert NEW_REPEATED.tool_inputs_per_call == [{"q": "first"}, {"q": "second"}]
    assert NEW_REPEATED.tool_outputs_per_call == ["first result", "second result"]
    assert NEW_REPEATED.tool_metas_per_call == [{"time_cost": 1}, {"time_cost": 2}]


def test_distinct_tools_read_one_value_each():
    thought = _agent_thought(
        tool="search;calculator",
        tool_input=json.dumps({"search": {"q": "a"}, "calculator": {"expr": "1+1"}}),
        observation=json.dumps({"search": "search result", "calculator": "2"}),
        tool_meta_str=json.dumps({"search": {"time_cost": 1}, "calculator": {"time_cost": 2}}),
    )

    assert thought.tool_inputs_per_call == [{"q": "a"}, {"expr": "1+1"}]
    assert thought.tool_outputs_per_call == ["search result", "2"]
    assert thought.tool_metas_per_call == [{"time_cost": 1}, {"time_cost": 2}]


def test_a_stored_list_that_is_not_one_value_per_call_is_replayed_whole():
    # the reader tells a per-call list from a single call's list value by length
    # alone; a length that does not match the call count is not per-call data
    thought = _agent_thought(
        tool="search;search",
        tool_input=json.dumps({"search": ["a", "b", "c"]}),
        observation=json.dumps({"search": ["x", "y", "z"]}),
        tool_meta_str=json.dumps({"search": {"time_cost": 1}}),
    )

    assert thought.tool_inputs_per_call == [["a", "b", "c"], ["a", "b", "c"]]
    assert thought.tool_outputs_per_call == [["x", "y", "z"], ["x", "y", "z"]]


def test_a_legacy_list_of_matching_length_is_read_per_call_not_whole():
    # the other half of the same decision. Length is the only signal the reader
    # has, so a single stored value that is itself a list as long as the call
    # count is indistinguishable from one value per call, and is read as one
    # value per call. A legacy row whose one value happened to be a two-element
    # list is therefore split across the two calls instead of replayed whole.
    thought = _agent_thought(
        tool="search;search",
        tool_input=json.dumps({"search": ["a", "b"]}),
        observation=json.dumps({"search": ["x", "y"]}),
        tool_meta_str=json.dumps({"search": {"time_cost": 1}}),
    )

    assert thought.tool_inputs_per_call == ["a", "b"]
    assert thought.tool_outputs_per_call == ["x", "y"]


def test_a_tool_missing_from_the_payload_reads_empty():
    thought = _agent_thought(
        tool="search;calculator",
        tool_input=json.dumps({"search": {"q": "a"}}),
        observation=json.dumps({"search": "search result"}),
        tool_meta_str="{}",
    )

    assert thought.tool_inputs_per_call == [{"q": "a"}, {}]
    assert thought.tool_outputs_per_call == ["search result", {}]
    assert thought.tool_metas_per_call == [{}, {}]
