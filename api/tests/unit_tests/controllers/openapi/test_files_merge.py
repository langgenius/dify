import os
from collections.abc import Mapping
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage

import services.errors.file as file_errors
from controllers.common.errors import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from controllers.openapi import _files as module
from controllers.openapi._errors import FilenameNotExists, InvalidFilePart
from controllers.openapi._files import FileRowKind, file_rows_of, materialize_files
from factories.file_factory.validation import is_file_valid_with_config
from graphon.file import FileTransferMethod, FileType, FileUploadConfig
from models.model import AppMode

_SESSION = Mock(spec=Session)

_DOCUMENT_VARIABLE_CONFIG = FileUploadConfig(
    allowed_file_types=[FileType.DOCUMENT],
    allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL],
    number_limits=5,
)
"""What a `document` file variable configured in the app builder hands the file factory."""

_CUSTOM_VARIABLE_CONFIG = FileUploadConfig(
    allowed_file_types=[FileType.CUSTOM],
    allowed_file_extensions=[".pdf"],
    allowed_file_upload_methods=[FileTransferMethod.LOCAL_FILE],
    number_limits=5,
)
"""A variable whose whitelist is the extension list, so the predicate answers on extension."""


def _fs(name: str, mimetype: str) -> FileStorage:
    return FileStorage(stream=BytesIO(b"bytes"), filename=name, content_type=mimetype)


def _accepted_by(mapping: Mapping[str, str], *, extension: str, config: FileUploadConfig) -> bool:
    """The check `factories.file_factory.build_from_mapping` runs on a mapping it built.

    `extension` is what the factory reads off the resolved file, not off the mapping.
    """
    return is_file_valid_with_config(
        input_file_type=mapping.get("type") or FileType.CUSTOM,
        file_extension=extension,
        file_transfer_method=FileTransferMethod(mapping["transfer_method"]),
        config=config,
    )


@pytest.fixture
def uploads(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = Mock()
    service.upload_file.side_effect = lambda **kw: SimpleNamespace(
        id=f"uf-{kw['filename']}",
        extension=os.path.splitext(kw["filename"])[1].lstrip(".").lower(),
        mime_type=kw["mimetype"],
    )
    monkeypatch.setattr(module, "application_services", lambda: SimpleNamespace(files=service))
    return service


def _form(*rows):
    return list(rows)


def _app(mode: AppMode, form, monkeypatch: pytest.MonkeyPatch):
    app = SimpleNamespace(mode=mode, id="app-1", tenant_id="t-1")
    monkeypatch.setattr(module, "resolve_app_config", lambda _app, **_kwargs: ({}, form))
    return app


def _run(app, *, inputs, files):
    return materialize_files(app=app, caller=None, inputs=inputs, files=files, rows=file_rows_of(app, _SESSION))


def test_file_rows_of_reads_both_row_types(monkeypatch: pytest.MonkeyPatch):
    form = _form({"file": {"variable": "doc"}}, {"file-list": {"variable": "pages"}}, {"text-input": {"variable": "q"}})
    app = _app(AppMode.WORKFLOW, form, monkeypatch)
    assert file_rows_of(app, _SESSION) == {"doc": FileRowKind.SINGLE, "pages": FileRowKind.LIST}


def test_single_file_variable_gets_local_file_mapping(uploads: Mock, monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    inputs, vision = _run(app, inputs={"q": "hi"}, files={"doc": _fs("r.pdf", "application/pdf")})
    assert inputs == {
        "q": "hi",
        "doc": {"transfer_method": "local_file", "upload_file_id": "uf-r.pdf", "type": FileType.DOCUMENT},
    }
    assert vision == []
    uploads.upload_file.assert_called_once()


@pytest.mark.usefixtures("uploads")
def test_file_list_variable_wraps_single_part_in_list(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file-list": {"variable": "pages"}}), monkeypatch)
    inputs, _ = _run(app, inputs={}, files={"pages": _fs("1.png", "image/png")})
    assert inputs["pages"] == [{"transfer_method": "local_file", "upload_file_id": "uf-1.png", "type": FileType.IMAGE}]


@pytest.mark.usefixtures("uploads")
def test_single_file_variable_rejects_two_parts(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    with pytest.raises(InvalidFilePart, match="one part"):
        _run(app, inputs={}, files={"doc": [_fs("a", "text/plain"), _fs("b", "text/plain")]})


@pytest.mark.usefixtures("uploads")
def test_unknown_variable_is_422_for_workflow(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form(), monkeypatch)
    with pytest.raises(InvalidFilePart, match="nope"):
        _run(app, inputs={}, files={"nope": _fs("a", "text/plain")})


def test_unknown_variable_goes_to_vision_for_chat(uploads: Mock, monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.CHAT, _form(), monkeypatch)
    inputs, vision = _run(app, inputs={}, files={"photo": _fs("p.jpg", "image/jpeg")})
    assert inputs == {}
    assert vision == [{"transfer_method": "local_file", "upload_file_id": "uf-p.jpg", "type": FileType.IMAGE}]
    uploads.upload_file.assert_called_once()


def test_url_string_in_file_variable_becomes_remote_url(uploads: Mock, monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    inputs, _ = _run(app, inputs={"doc": "https://x/a.pdf"}, files=None)
    assert inputs["doc"] == {
        "transfer_method": "remote_url",
        "url": "https://x/a.pdf",
        "type": FileType.DOCUMENT,
    }
    uploads.upload_file.assert_not_called()


@pytest.mark.usefixtures("uploads")
def test_inputs_not_mutated(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    original = {"doc": "https://x/a.pdf"}
    _run(app, inputs=original, files=None)
    assert original == {"doc": "https://x/a.pdf"}


@pytest.mark.usefixtures("uploads")
def test_form_rows_treat_every_part_as_a_single_file(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.ADVANCED_CHAT, _form(), monkeypatch)
    rows = {"attachment": FileRowKind.SINGLE}
    inputs, vision = materialize_files(
        app=app,
        caller=None,
        inputs={"comment": "ok"},
        files={"attachment": _fs("a.pdf", "application/pdf")},
        rows=rows,
    )
    assert inputs == {
        "comment": "ok",
        "attachment": {"transfer_method": "local_file", "upload_file_id": "uf-a.pdf", "type": FileType.DOCUMENT},
    }
    assert vision == []


@pytest.mark.parametrize(
    ("service_error", "openapi_error"),
    [
        pytest.param(file_errors.FileTooLargeError("100MB"), FileTooLargeError, id="file_too_large"),
        pytest.param(file_errors.UnsupportedFileTypeError(), UnsupportedFileTypeError, id="unsupported_file_type"),
        pytest.param(
            file_errors.BlockedFileExtensionError("exe blocked"), BlockedFileExtensionError, id="blocked_extension"
        ),
    ],
)
def test_upload_service_errors_translate_to_the_openapi_contract(
    uploads: Mock, monkeypatch: pytest.MonkeyPatch, service_error: Exception, openapi_error: type[Exception]
):
    uploads.upload_file.side_effect = service_error
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    with pytest.raises(openapi_error):
        _run(app, inputs={}, files={"doc": _fs("a.pdf", "application/pdf")})


@pytest.mark.usefixtures("uploads")
def test_local_file_mapping_is_accepted_by_a_document_variables_upload_config(monkeypatch: pytest.MonkeyPatch):
    """The mapping goes on to `build_from_mapping`, which validates its `type`
    against the variable's config. A mapping with no `type` falls into the
    `custom` bucket and every normal file variable refuses it.
    """
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    inputs, _ = _run(app, inputs={}, files={"doc": _fs("r.pdf", "application/pdf")})
    assert _accepted_by(inputs["doc"], extension=".pdf", config=_DOCUMENT_VARIABLE_CONFIG)


@pytest.mark.usefixtures("uploads")
def test_remote_url_mapping_is_accepted_by_a_document_variables_upload_config(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    inputs, _ = _run(app, inputs={"doc": "https://x/a.pdf?sig=1"}, files=None)
    assert _accepted_by(inputs["doc"], extension=".pdf", config=_DOCUMENT_VARIABLE_CONFIG)


@pytest.mark.usefixtures("uploads")
def test_mapping_is_refused_when_the_config_does_not_allow_the_extension(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    inputs, _ = _run(app, inputs={}, files={"doc": _fs("a.zip", "application/zip")})
    assert not _accepted_by(inputs["doc"], extension=".zip", config=_CUSTOM_VARIABLE_CONFIG)


@pytest.mark.usefixtures("uploads")
def test_part_without_a_mimetype_is_refused_like_the_upload_route(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    with pytest.raises(UnsupportedFileTypeError):
        _run(app, inputs={}, files={"doc": FileStorage(stream=BytesIO(b"bytes"), filename="r.pdf")})


@pytest.mark.usefixtures("uploads")
def test_part_without_a_filename_is_refused_like_the_upload_route(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    with pytest.raises(FilenameNotExists):
        _run(app, inputs={}, files={"doc": _fs("", "application/pdf")})
