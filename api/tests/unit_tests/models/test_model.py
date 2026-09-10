from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from core.workflow.file_reference import build_file_reference
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod
from models import model as model_module
from models.model import App, AppMode, Conversation, IconType, Message


@pytest.fixture(autouse=True)
def patch_file_helpers(monkeypatch: pytest.MonkeyPatch):
    """
    Patch file_helpers.get_signed_file_url to a deterministic stub.
    """
    monkeypatch.setattr(
        model_module.file_helpers,
        "get_signed_file_url",
        lambda file_id: f"https://signed.example/{file_id}",
    )


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


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_message_inputs_resolve_file_tenant_with_caller_session(sqlite_session: Session) -> None:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="File owner",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="file",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    decoy = App(
        id="other-app",
        tenant_id="other-tenant",
        name="Decoy",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="file",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    sqlite_session.add_all([decoy, app])
    sqlite_session.flush()
    message = Message(app_id="app-1")
    message.inputs = {"file": _build_local_file_mapping("upload-1")}

    with patch(
        "models.model.build_file_from_input_mapping",
        side_effect=lambda **kwargs: kwargs["tenant_resolver"](),
    ):
        inputs = message.inputs_with_session(session=sqlite_session)

    assert inputs["file"] == "tenant-1"
    # session.scalar.assert_called_once()  # removed: see #40799 conftest note


def test_file_url_bare_url_re_signed():
    """#40788: bare tool file URL (no markdown wrapping) must be re-signed.

    Bare URLs are produced by the agent runtime when the model returns a
    non-linkified file reference. The previous regex only matched
    [text](url) markdown form, so the bare URL kept INTERNAL_FILES_URL.
    """
    upload_id = "bare-1"
    url = f"/files/{upload_id}/file-preview?timestamp=1&nonce=2&sign=3"
    msg = Message(answer=url)  # bare, no markdown wrapping

    out = msg.re_sign_file_url_answer
    assert f"https://signed.example/{upload_id}" in out
    assert url not in out


def test_file_url_backticked_url_re_signed():
    """#40788: backticked tool file URL must be re-signed.

    Backticks are used by the runtime to quote file references inline.
    The previous regex only matched [text](url), so backticked URLs
    stayed on INTERNAL_FILES_URL.
    """
    upload_id = "tick-2"
    url = f"/files/{upload_id}/file-preview?timestamp=10&nonce=20&sign=30"
    msg = Message(answer=f"see `{url}` for details")

    out = msg.re_sign_file_url_answer
    assert f"https://signed.example/{upload_id}" in out
    assert url not in out


def test_file_url_mixed_formats_all_re_signed():
    """#40788: all three URL shapes in the same answer are re-signed.

    Sanity check that the three patterns cooperate — bare, backticked,
    and markdown — without double-signing or skipping any.
    """
    upload_ids = ["mix-a", "mix-b", "mix-c"]
    bare = f"/files/{upload_ids[0]}/file-preview?timestamp=1&nonce=2&sign=3"
    tick = f"/files/{upload_ids[1]}/file-preview?timestamp=10&nonce=20&sign=30"
    md = f"/files/{upload_ids[2]}/file-preview?timestamp=100&nonce=200&sign=300"
    msg = Message(answer=f"raw {bare} ` {tick} ` and [file]({md})")

    out = msg.re_sign_file_url_answer
    for uid in upload_ids:
        assert f"https://signed.example/{uid}" in out
    for url in (bare, tick, md):
        assert url not in out
