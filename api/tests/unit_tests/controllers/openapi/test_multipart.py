from io import BytesIO

import pytest
from flask import Flask
from werkzeug.datastructures import FileStorage

from controllers.openapi._errors import InvalidFilePart
from controllers.openapi._multipart import body_from_request


@pytest.fixture
def app() -> Flask:
    a = Flask(__name__)
    a.config["TESTING"] = True
    return a


def test_json_request_passes_through(app: Flask):
    with app.test_request_context("/x", method="POST", json={"inputs": {"q": "hi"}}):
        assert body_from_request() == {"inputs": {"q": "hi"}}


def test_empty_body_is_empty_dict(app: Flask):
    with app.test_request_context("/x", method="POST"):
        assert body_from_request() == {}


def test_multipart_parses_json_parts_and_file_parts(app: Flask):
    data = {
        "inputs": '{"q": "refund 42"}',
        "workflow_id": '"wf-1"',
        "files[doc]": (BytesIO(b"pdf"), "r.pdf", "application/pdf"),
        "files[pages]": [(BytesIO(b"1"), "1.png", "image/png"), (BytesIO(b"2"), "2.png", "image/png")],
    }
    with app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data"):
        body = body_from_request()
    assert body["inputs"] == {"q": "refund 42"}
    assert body["workflow_id"] == "wf-1"
    assert isinstance(body["files"]["doc"], FileStorage)
    assert [f.filename for f in body["files"]["pages"]] == ["1.png", "2.png"]


def test_multipart_rejects_non_json_text_part(app: Flask):
    with app.test_request_context("/x", method="POST", data={"inputs": "not json"}, content_type="multipart/form-data"):
        with pytest.raises(InvalidFilePart, match="inputs"):
            body_from_request()


def test_multipart_rejects_file_part_outside_files_namespace(app: Flask):
    data = {"file": (BytesIO(b"x"), "x.txt", "text/plain")}
    with app.test_request_context("/x", method="POST", data=data, content_type="multipart/form-data"):
        with pytest.raises(InvalidFilePart, match="file"):
            body_from_request()
