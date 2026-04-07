from io import BytesIO

import pytest

from core.rag.extractor.blob.blob import Blob


class TestBlob:
    def test_requires_data_or_path(self):
        with pytest.raises(ValueError, match="Either data or path must be provided"):
            Blob()

    def test_source_property_and_repr_include_path(self, tmp_path):
        file_path = tmp_path / "sample.txt"
        file_path.write_text("hello", encoding="utf-8")

        blob = Blob.from_path(str(file_path))

        assert blob.source == str(file_path)
        assert str(file_path) in repr(blob)

    def test_as_string_from_bytes_and_str(self):
        assert Blob.from_data(b"abc").as_string() == "abc"
        assert Blob.from_data("plain-text").as_string() == "plain-text"

    def test_as_string_from_path(self, tmp_path):
        file_path = tmp_path / "sample.txt"
        file_path.write_text("from-file", encoding="utf-8")

        blob = Blob.from_path(str(file_path))

        assert blob.as_string() == "from-file"

    def test_as_string_raises_for_invalid_state(self):
        blob = Blob.model_construct(data=None, path=None, mimetype=None, encoding="utf-8")

        with pytest.raises(ValueError, match="Unable to get string for blob"):
            blob.as_string()

    def test_as_bytes_from_bytes_str_and_path(self, tmp_path):
        from_bytes = Blob.from_data(b"abc")
        from_str = Blob.from_data("abc", encoding="utf-8")

        file_path = tmp_path / "sample.bin"
        file_path.write_bytes(b"from-path")
        from_path = Blob.from_path(str(file_path))

        assert from_bytes.as_bytes() == b"abc"
        assert from_str.as_bytes() == b"abc"
        assert from_path.as_bytes() == b"from-path"

    def test_as_bytes_raises_for_invalid_state(self):
        blob = Blob.model_construct(data=None, path=None, mimetype=None, encoding="utf-8")

        with pytest.raises(ValueError, match="Unable to get bytes for blob"):
            blob.as_bytes()

    def test_as_bytes_io_for_bytes_and_path(self, tmp_path):
        data_blob = Blob.from_data(b"bytes-io")
        with data_blob.as_bytes_io() as stream:
            assert isinstance(stream, BytesIO)
            assert stream.read() == b"bytes-io"

        file_path = tmp_path / "stream.bin"
        file_path.write_bytes(b"path-stream")
        path_blob = Blob.from_path(str(file_path))
        with path_blob.as_bytes_io() as stream:
            assert stream.read() == b"path-stream"

    def test_as_bytes_io_raises_for_unsupported_data_type(self):
        blob = Blob.from_data("text-value")

        with pytest.raises(NotImplementedError, match="Unable to convert blob"):
            with blob.as_bytes_io():
                pass

    def test_from_path_respects_guessing_and_explicit_mime(self, tmp_path):
        file_path = tmp_path / "example.txt"
        file_path.write_text("x", encoding="utf-8")

        guessed = Blob.from_path(str(file_path))
        explicit = Blob.from_path(str(file_path), mime_type="custom/type", guess_type=False)

        assert guessed.mimetype == "text/plain"
        assert explicit.mimetype == "custom/type"
