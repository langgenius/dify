"""Multipart bodies become the same dict a JSON body would be; file parts land where their name says."""

from io import BytesIO

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage

from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._multipart import body_from_request

_FILE_FIELDS = frozenset({"file", "files", "attachments"})


@pytest.fixture
def app() -> Flask:
    a = Flask(__name__)
    a.config["TESTING"] = True
    return a


def _part(name: str = "x.txt") -> tuple[BytesIO, str]:
    return (BytesIO(b"x"), name)


def _multipart(app: Flask, data: dict):
    return app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data")


def test_json_request_passes_through(app: Flask):
    with app.test_request_context("/x", method="POST", json={"inputs": {"q": "hi"}}):
        assert body_from_request(file_fields=_FILE_FIELDS) == {"inputs": {"q": "hi"}}


def test_multipart_places_every_part_name_shape(app: Flask):
    data = {
        "inputs": '{"q": "refund 42"}',
        "file": _part("one.txt"),
        "files[doc]": _part("r.pdf"),
        "files[pages][]": [_part("1.png"), _part("2.png")],
        "attachments[]": _part("p.jpg"),
    }
    with _multipart(app, data):
        body = body_from_request(file_fields=_FILE_FIELDS)
    assert body["inputs"] == {"q": "refund 42"}
    assert isinstance(body["file"], FileStorage)
    assert isinstance(body["files"]["doc"], FileStorage)
    assert [f.filename for f in body["files"]["pages"]] == ["1.png", "2.png"]
    assert [f.filename for f in body["attachments"]] == ["p.jpg"]


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        pytest.param({"inputs": "not json"}, "JSON text", id="text_part_not_json"),
        pytest.param({"inputs[doc]": _part()}, "does not take a file", id="field_is_not_a_file_field"),
        pytest.param({"files[a][b]": _part()}, "named", id="two_keys"),
        pytest.param(
            {"files[doc]": [_part("a.pdf"), _part("b.pdf")]}, r"files\[doc\]\[\]", id="repeated_without_marker"
        ),
        pytest.param({"files": '{"doc": "x"}', "files[doc]": _part()}, "file parts", id="json_text_in_file_field"),
    ],
)
def test_multipart_rejects_malformed_bodies(app: Flask, data: dict, reason: str):
    with _multipart(app, data), pytest.raises(InvalidFilePart, match=reason):
        body_from_request(file_fields=_FILE_FIELDS)
