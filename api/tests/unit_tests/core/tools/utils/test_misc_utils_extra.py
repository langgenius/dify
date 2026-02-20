from __future__ import annotations

import uuid

import pytest
from yaml import YAMLError

from core.tools.utils.text_processing_utils import remove_leading_symbols
from core.tools.utils.uuid_utils import is_valid_uuid
from core.tools.utils.yaml_utils import _load_yaml_file, load_yaml_file_cached


def test_remove_leading_symbols_preserves_markdown_link_and_strips_punctuation():
    markdown = "[Example](https://example.com) content"
    assert remove_leading_symbols(markdown) == markdown

    assert remove_leading_symbols("...Hello world") == "Hello world"


def test_is_valid_uuid_handles_valid_invalid_and_empty_values():
    assert is_valid_uuid(str(uuid.uuid4())) is True
    assert is_valid_uuid("not-a-uuid") is False
    assert is_valid_uuid("") is False
    assert is_valid_uuid(None) is False


def test_yaml_utils_load_and_cache_behaviors(tmp_path):
    valid_file = tmp_path / "valid.yaml"
    valid_file.write_text("a: 1\nb: two\n", encoding="utf-8")
    invalid_file = tmp_path / "invalid.yaml"
    invalid_file.write_text("a: [1, 2\n", encoding="utf-8")

    loaded = _load_yaml_file(file_path=str(valid_file))
    assert loaded == {"a": 1, "b": "two"}

    # cached loader should return consistent content and use cache key.
    load_yaml_file_cached.cache_clear()
    assert load_yaml_file_cached(str(valid_file)) == {"a": 1, "b": "two"}
    assert load_yaml_file_cached(str(valid_file)) == {"a": 1, "b": "two"}

    with pytest.raises(FileNotFoundError):
        _load_yaml_file(file_path=str(tmp_path / "missing.yaml"))

    with pytest.raises(YAMLError):
        _load_yaml_file(file_path=str(invalid_file))
