import pytest

from core.rag.datasource.vdb.field import parse_metadata_json


class TestParseMetadataJson:
    def test_none_returns_empty_dict(self):
        assert parse_metadata_json(None) == {}

    def test_empty_string_returns_empty_dict(self):
        assert parse_metadata_json("") == {}

    def test_valid_json_string(self):
        result = parse_metadata_json('{"doc_id": "abc", "score": 0.9}')
        assert result == {"doc_id": "abc", "score": 0.9}

    def test_dict_passthrough(self):
        original = {"doc_id": "abc", "document_id": "123"}
        result = parse_metadata_json(original)
        assert result == original

    def test_empty_json_object(self):
        assert parse_metadata_json("{}") == {}

    def test_invalid_json_raises_value_error(self):
        with pytest.raises(ValueError):
            parse_metadata_json("{invalid json")

    def test_nested_metadata(self):
        result = parse_metadata_json('{"doc_id": "1", "extra": {"nested": true}}')
        assert result["extra"]["nested"] is True

    def test_non_str_non_dict_returns_empty_dict(self):
        assert parse_metadata_json(123) == {}
        assert parse_metadata_json([1, 2]) == {}

    def test_bytes_input(self):
        result = parse_metadata_json(b'{"key": "value"}')
        assert result == {"key": "value"}

    def test_empty_bytes_returns_empty_dict(self):
        assert parse_metadata_json(b"") == {}

    def test_empty_bytearray_returns_empty_dict(self):
        assert parse_metadata_json(bytearray(b"")) == {}
