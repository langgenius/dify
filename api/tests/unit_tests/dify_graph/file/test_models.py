from core.workflow.file_reference import build_file_reference
from dify_graph.file import File, FileTransferMethod, FileType, helpers


def _build_local_file(*, reference: str, storage_key: str | None = None) -> File:
    return File(
        id="file-id",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference=reference,
        filename="report.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=128,
        storage_key=storage_key,
    )


def test_file_exposes_legacy_aliases_from_opaque_reference() -> None:
    reference = build_file_reference(record_id="upload-file-id", storage_key="files/report.pdf")

    file = _build_local_file(reference=reference)

    assert file.reference == reference
    assert file.related_id == "upload-file-id"
    assert file.storage_key == "files/report.pdf"


def test_file_falls_back_to_raw_reference_when_opaque_reference_is_invalid() -> None:
    file = _build_local_file(reference="dify-file-ref:not-base64", storage_key="fallback-key")

    assert file.related_id == "dify-file-ref:not-base64"
    assert file.storage_key == "fallback-key"


def test_file_to_dict_keeps_reference_and_legacy_related_id(monkeypatch) -> None:
    reference = build_file_reference(record_id="upload-file-id", storage_key="files/report.pdf")
    file = _build_local_file(reference=reference)
    monkeypatch.setattr(helpers, "resolve_file_url", lambda _file, for_external=True: "https://example.com/report.pdf")

    serialized = file.to_dict()

    assert serialized["reference"] == reference
    assert serialized["related_id"] == "upload-file-id"
    assert serialized["url"] == "https://example.com/report.pdf"


def test_file_related_id_setter_updates_reference_alias() -> None:
    file = _build_local_file(reference="upload-file-id", storage_key="files/report.pdf")

    file.related_id = "replacement-upload-id"

    assert file.reference == "replacement-upload-id"
    assert file.related_id == "replacement-upload-id"
