from io import BytesIO

import pytest
from pydantic import BaseModel, ValidationError
from werkzeug.datastructures import FileStorage

from controllers.openapi._upload import UploadParts


class _M(BaseModel):
    files: UploadParts | None = None


def _fs(name: str = "a.txt") -> FileStorage:
    return FileStorage(stream=BytesIO(b"x"), filename=name, content_type="text/plain")


def test_upload_part_accepts_file_storage_single_and_list():
    m = _M(files={"doc": _fs(), "docs": [_fs("1.txt"), _fs("2.txt")]})
    assert isinstance(m.files["doc"], FileStorage)
    assert [f.filename for f in m.files["docs"]] == ["1.txt", "2.txt"]


def test_upload_part_rejects_strings():
    with pytest.raises(ValidationError):
        _M(files={"doc": "./local.pdf"})


def test_upload_part_json_schema_is_binary_string():
    schema = _M.model_json_schema()
    files = schema["properties"]["files"]["anyOf"][0]
    assert files["type"] == "object"
    leaf = files["additionalProperties"]
    assert leaf["anyOf"][0] == {"type": "string", "format": "binary"}
    assert leaf["anyOf"][1] == {"type": "array", "items": {"type": "string", "format": "binary"}}
