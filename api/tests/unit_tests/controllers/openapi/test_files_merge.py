from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.datastructures import FileStorage

from controllers.openapi import _files as module
from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._files import FileRowKind, file_rows_of, materialize_files
from models.model import AppMode


def _fs(name: str, mimetype: str) -> FileStorage:
    return FileStorage(stream=BytesIO(b"bytes"), filename=name, content_type=mimetype)


@pytest.fixture
def uploads(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = Mock()
    service.upload_file.side_effect = lambda **kw: SimpleNamespace(id=f"uf-{kw['filename']}")
    monkeypatch.setattr(module, "application_services", lambda: SimpleNamespace(files=service))
    return service


def _form(*rows):
    return list(rows)


def _app(mode: AppMode, form, monkeypatch: pytest.MonkeyPatch):
    app = SimpleNamespace(mode=mode, id="app-1", tenant_id="t-1")
    monkeypatch.setattr(module, "resolve_app_config", lambda _app, **_kwargs: ({}, form))
    return app


def _run(app, *, inputs, files):
    return materialize_files(app=app, caller=None, inputs=inputs, files=files, rows=file_rows_of(app, None))


def test_file_rows_of_reads_both_row_types(monkeypatch: pytest.MonkeyPatch):
    form = _form({"file": {"variable": "doc"}}, {"file-list": {"variable": "pages"}}, {"text-input": {"variable": "q"}})
    app = _app(AppMode.WORKFLOW, form, monkeypatch)
    assert file_rows_of(app, None) == {"doc": FileRowKind.SINGLE, "pages": FileRowKind.LIST}


def test_single_file_variable_gets_local_file_mapping(uploads: Mock, monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    inputs, vision = _run(app, inputs={"q": "hi"}, files={"doc": _fs("r.pdf", "application/pdf")})
    assert inputs == {"q": "hi", "doc": {"transfer_method": "local_file", "upload_file_id": "uf-r.pdf"}}
    assert vision == []
    uploads.upload_file.assert_called_once()


@pytest.mark.usefixtures("uploads")
def test_file_list_variable_wraps_single_part_in_list(monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file-list": {"variable": "pages"}}), monkeypatch)
    inputs, _ = _run(app, inputs={}, files={"pages": _fs("1.png", "image/png")})
    assert inputs["pages"] == [{"transfer_method": "local_file", "upload_file_id": "uf-1.png"}]


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
    assert vision == [{"transfer_method": "local_file", "upload_file_id": "uf-p.jpg"}]
    uploads.upload_file.assert_called_once()


def test_url_string_in_file_variable_becomes_remote_url(uploads: Mock, monkeypatch: pytest.MonkeyPatch):
    app = _app(AppMode.WORKFLOW, _form({"file": {"variable": "doc"}}), monkeypatch)
    inputs, _ = _run(app, inputs={"doc": "https://x/a.pdf"}, files=None)
    assert inputs["doc"] == {"transfer_method": "remote_url", "url": "https://x/a.pdf"}
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
    assert inputs == {"comment": "ok", "attachment": {"transfer_method": "local_file", "upload_file_id": "uf-a.pdf"}}
    assert vision == []
