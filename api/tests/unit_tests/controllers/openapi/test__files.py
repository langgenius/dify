"""Uploaded parts become the local-file mappings the core file factory accepts, merged into inputs by name."""

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.datastructures import FileStorage

from controllers.openapi import _files as module
from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._files import merge_files
from factories.file_factory.validation import is_file_valid_with_config
from graphon.file import FileTransferMethod, FileType, FileUploadConfig

_DOCUMENT_VARIABLE_CONFIG = FileUploadConfig(
    allowed_file_types=[FileType.DOCUMENT],
    allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL],
    number_limits=5,
)


def _fs(name: str, mimetype: str) -> FileStorage:
    return FileStorage(stream=BytesIO(b"bytes"), filename=name, content_type=mimetype)


@pytest.fixture(autouse=True)
def uploads(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = Mock()
    service.upload_file.side_effect = lambda **kw: SimpleNamespace(
        id=f"uf-{kw['filename']}", extension=kw["filename"].rsplit(".", 1)[-1], mime_type=kw["mimetype"]
    )
    monkeypatch.setattr(module, "application_services", lambda: SimpleNamespace(files=service))
    return service


def test_parts_become_mappings_the_core_file_factory_accepts() -> None:
    original = {"q": "hi"}
    inputs = merge_files(original, {"doc": _fs("r.pdf", "application/pdf"), "pages": [_fs("1.png", "image/png")]}, None)
    assert original == {"q": "hi"}
    assert inputs == {
        "q": "hi",
        "doc": {"transfer_method": "local_file", "upload_file_id": "uf-r.pdf", "type": FileType.DOCUMENT},
        "pages": [{"transfer_method": "local_file", "upload_file_id": "uf-1.png", "type": FileType.IMAGE}],
    }
    assert is_file_valid_with_config(
        input_file_type=inputs["doc"]["type"],
        file_extension=".pdf",
        file_transfer_method=FileTransferMethod(inputs["doc"]["transfer_method"]),
        config=_DOCUMENT_VARIABLE_CONFIG,
    )


def test_a_name_given_in_both_inputs_and_files_is_refused() -> None:
    with pytest.raises(InvalidFilePart, match="doc"):
        merge_files({"doc": "https://x/a.pdf"}, {"doc": _fs("a.pdf", "application/pdf")}, None)
