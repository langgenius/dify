"""Multipart bodies become the same dict a JSON body would be; file parts land where their name says."""

from collections.abc import Mapping
from io import BytesIO

import pytest
from flask import Flask
from flask.ctx import RequestContext
from werkzeug.datastructures import FileStorage

from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._multipart import body_from_request, folder_streams
from controllers.openapi._upload import UploadParts

_FILE_FIELDS = frozenset({"file", "files", "attachments"})


@pytest.fixture
def app() -> Flask:
    a = Flask(__name__)
    a.config["TESTING"] = True
    return a


def _part(name: str = "x.txt") -> tuple[BytesIO, str]:
    return (BytesIO(b"x"), name)


def _multipart(app: Flask, data: Mapping[str, object]) -> RequestContext:
    return app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data")


def test_json_request_passes_through(app: Flask) -> None:
    with app.test_request_context("/x", method="POST", json={"inputs": {"q": "hi"}}):
        assert body_from_request(file_fields=_FILE_FIELDS) == {"inputs": {"q": "hi"}}


def test_multipart_places_every_part_name_shape(app: Flask) -> None:
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
def test_multipart_rejects_malformed_bodies(app: Flask, data: Mapping[str, object], reason: str) -> None:
    with _multipart(app, data), pytest.raises(InvalidFilePart, match=reason):
        body_from_request(file_fields=_FILE_FIELDS)


def test_folder_streams_maps_each_path_to_its_stream() -> None:
    first, second = FileStorage(stream=BytesIO(b"a")), FileStorage(stream=BytesIO(b"b"))
    streams = folder_streams({"SKILL.md": first, "scripts/run.py": second})
    assert streams == {"SKILL.md": first.stream, "scripts/run.py": second.stream}


def test_folder_streams_rejects_a_path_given_more_than_once() -> None:
    parts: UploadParts = {"SKILL.md": [FileStorage(stream=BytesIO(b"a")), FileStorage(stream=BytesIO(b"b"))]}
    with pytest.raises(InvalidFilePart, match="SKILL.md"):
        folder_streams(parts)


@pytest.mark.parametrize("direct", ["files", "files[]"])
@pytest.mark.parametrize("mapped", ["files[doc]", "files[doc][]"])
@pytest.mark.parametrize("mapped_first", [False, True], ids=["direct_first", "mapped_first"])
def test_multipart_rejects_conflicting_file_shapes(app: Flask, direct: str, mapped: str, mapped_first: bool) -> None:
    names = [mapped, direct] if mapped_first else [direct, mapped]
    data = {name: _part() for name in names}
    with _multipart(app, data), pytest.raises(InvalidFilePart, match="given more than once") as exc:
        body_from_request(file_fields=_FILE_FIELDS)
    assert exc.value.code == 422
