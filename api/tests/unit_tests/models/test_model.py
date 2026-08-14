import importlib
import types
from unittest.mock import MagicMock, patch

import pytest

from core.workflow.file_reference import build_file_reference
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod
from models.model import Conversation, Message


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


def test_bare_file_preview_url_replaced():
    """
    A file-preview URL that is not wrapped in markdown must still be re-signed.
    """
    upload_id = "bare-1"
    url = f"http://api:5001/files/{upload_id}/file-preview?timestamp=111&nonce=222&sign=333"
    msg = Message(answer=f"Download:\n{url}")

    out = msg.re_sign_file_url_answer
    assert f"https://signed.example/{upload_id}" in out
    assert "http://api:5001" not in out


def test_backticked_tool_file_url_replaced(monkeypatch: pytest.MonkeyPatch):
    """
    A tool file URL inside backticks must be re-signed, including the internal host.
    """
    model_module = importlib.import_module("models.model")
    monkeypatch.setattr(
        model_module,
        "sign_tool_file",
        lambda tool_file_id, extension: f"https://signed.example/tools/{tool_file_id}{extension}",
    )

    tool_file_id = "5c465079-d1ee-c17e-f8fd-000000000001"
    url = f"http://api:5001/files/tools/{tool_file_id}.txt?timestamp=111&nonce=222&sign=333"
    msg = Message(answer=f"Download:\n`{url}`")

    out = msg.re_sign_file_url_answer
    assert out == f"Download:\n`https://signed.example/tools/{tool_file_id}.txt`"


def test_multiple_bare_urls_replaced_independently():
    """
    Two bare URLs in one answer must each be re-signed, not collapsed into one greedy match.
    """
    first = "/files/multi-a/file-preview?timestamp=1&nonce=2&sign=3"
    second = "/files/multi-b/file-preview?timestamp=4&nonce=5&sign=6"
    msg = Message(answer=f"first {first} then {second}")

    out = msg.re_sign_file_url_answer
    assert out == "first https://signed.example/multi-a then https://signed.example/multi-b"


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
