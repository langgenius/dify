import importlib
import types

import pytest
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod

from core.workflow.file_reference import build_file_reference
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
def test_inputs_resolve_owner_tenant_for_single_file_mapping(
    monkeypatch: pytest.MonkeyPatch,
    owner_cls: type[Conversation] | type[Message],
):
    model_module = importlib.import_module("models.model")
    build_calls: list[tuple[dict[str, object], str]] = []

    monkeypatch.setattr(model_module.db.session, "scalar", lambda _: "tenant-from-app")

    def fake_build_from_mapping(*, mapping, tenant_id, config=None, strict_type_validation=False, access_controller):
        _ = config, strict_type_validation, access_controller
        build_calls.append((dict(mapping), tenant_id))
        return {"tenant_id": tenant_id, "upload_file_id": mapping.get("upload_file_id")}

    monkeypatch.setattr("factories.file_factory.build_from_mapping", fake_build_from_mapping)

    owner = owner_cls(app_id="app-1")
    owner.inputs = {"file": _build_local_file_mapping("upload-1")}

    restored_inputs = owner.inputs

    assert restored_inputs["file"] == {"tenant_id": "tenant-from-app", "upload_file_id": "upload-1"}
    assert build_calls == [
        (
            {
                **_build_local_file_mapping("upload-1"),
                "upload_file_id": "upload-1",
            },
            "tenant-from-app",
        )
    ]


@pytest.mark.parametrize("owner_cls", [Conversation, Message])
def test_inputs_resolve_owner_tenant_for_file_list_mapping(
    monkeypatch: pytest.MonkeyPatch,
    owner_cls: type[Conversation] | type[Message],
):
    model_module = importlib.import_module("models.model")
    build_calls: list[tuple[dict[str, object], str]] = []

    monkeypatch.setattr(model_module.db.session, "scalar", lambda _: "tenant-from-app")

    def fake_build_from_mapping(*, mapping, tenant_id, config=None, strict_type_validation=False, access_controller):
        _ = config, strict_type_validation, access_controller
        build_calls.append((dict(mapping), tenant_id))
        return {"tenant_id": tenant_id, "upload_file_id": mapping.get("upload_file_id")}

    monkeypatch.setattr("factories.file_factory.build_from_mapping", fake_build_from_mapping)

    owner = owner_cls(app_id="app-1")
    owner.inputs = {
        "files": [
            _build_local_file_mapping("upload-1"),
            _build_local_file_mapping("upload-2"),
        ]
    }

    restored_inputs = owner.inputs

    assert restored_inputs["files"] == [
        {"tenant_id": "tenant-from-app", "upload_file_id": "upload-1"},
        {"tenant_id": "tenant-from-app", "upload_file_id": "upload-2"},
    ]
    assert build_calls == [
        (
            {
                **_build_local_file_mapping("upload-1"),
                "upload_file_id": "upload-1",
            },
            "tenant-from-app",
        ),
        (
            {
                **_build_local_file_mapping("upload-2"),
                "upload_file_id": "upload-2",
            },
            "tenant-from-app",
        ),
    ]


@pytest.mark.parametrize("owner_cls", [Conversation, Message])
def test_inputs_prefer_serialized_tenant_id_when_present(
    monkeypatch: pytest.MonkeyPatch,
    owner_cls: type[Conversation] | type[Message],
):
    model_module = importlib.import_module("models.model")

    def fail_if_called(_):
        raise AssertionError("App tenant lookup should not run when tenant_id exists in the file mapping")

    monkeypatch.setattr(model_module.db.session, "scalar", fail_if_called)

    def fake_build_from_mapping(*, mapping, tenant_id, config=None, strict_type_validation=False, access_controller):
        _ = config, strict_type_validation, access_controller
        return {"tenant_id": tenant_id, "upload_file_id": mapping.get("upload_file_id")}

    monkeypatch.setattr("factories.file_factory.build_from_mapping", fake_build_from_mapping)

    owner = owner_cls(app_id="app-1")
    owner.inputs = {"file": _build_local_file_mapping("upload-1", tenant_id="tenant-from-payload")}

    restored_inputs = owner.inputs

    assert restored_inputs["file"] == {
        "tenant_id": "tenant-from-payload",
        "upload_file_id": "upload-1",
    }


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
