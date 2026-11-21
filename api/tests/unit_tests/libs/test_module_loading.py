"""Unit tests for ``libs.module_loading`` (``cached_import`` / ``import_string``).

These helpers mirror Django's module loading utilities. The cases below pin the
dotted-path parsing, the sys.modules cache, and the exact ImportError messages
that callers rely on. All inputs are valid ``str`` values - no deliberately
mistyped arguments, so the file stays clean under the strict test-tree type gate.
"""

import collections
import json
import os
import pathlib
import sys

import pytest

from libs.module_loading import cached_import, import_string


def test_import_string_resolves_a_stdlib_class() -> None:
    assert import_string("pathlib.Path") is pathlib.Path


def test_import_string_resolves_a_stdlib_function() -> None:
    assert import_string("json.dumps") is json.dumps


def test_import_string_resolves_a_nested_module_attribute() -> None:
    assert import_string("os.path.join") is os.path.join


def test_import_string_resolves_a_class_from_collections() -> None:
    assert import_string("collections.OrderedDict") is collections.OrderedDict


def test_import_string_result_is_callable() -> None:
    loaded = import_string("json.loads")
    assert callable(loaded)
    assert loaded("1") == 1


def test_cached_import_resolves_module_attribute() -> None:
    assert cached_import("json", "dumps") is json.dumps


def test_cached_import_resolves_a_class() -> None:
    assert cached_import("pathlib", "Path") is pathlib.Path


def test_cached_import_returns_same_object_on_repeat() -> None:
    first = cached_import("json", "JSONDecoder")
    second = cached_import("json", "JSONDecoder")
    assert first is second


def test_cached_import_uses_already_loaded_module() -> None:
    assert "json" in sys.modules
    assert cached_import("json", "loads") is sys.modules["json"].loads


def test_import_string_without_dot_raises_importerror() -> None:
    with pytest.raises(ImportError, match="doesn't look like a module path"):
        import_string("nodots")


def test_import_string_unknown_attribute_raises_importerror() -> None:
    with pytest.raises(ImportError, match='does not define a "NoSuchThing" attribute/class'):
        import_string("json.NoSuchThing")


def test_import_string_unknown_module_raises_importerror() -> None:
    with pytest.raises(ImportError):
        import_string("no_such_module_for_tests.Thing")


def test_import_string_splits_on_last_dot() -> None:
    # "os.path.join" -> module "os.path", attribute "join"
    assert import_string("os.path.join")("a", "b") == os.path.join("a", "b")


def test_import_string_can_resolve_this_modules_own_function() -> None:
    assert import_string("libs.module_loading.import_string") is import_string


def test_cached_import_and_import_string_agree() -> None:
    assert import_string("json.dumps") is cached_import("json", "dumps")


def test_import_string_accepts_a_module_level_constant() -> None:
    assert import_string("os.path.sep") == os.path.sep


def test_import_string_error_is_importerror_subclass() -> None:
    with pytest.raises(ImportError) as exc_info:
        import_string("json.Missing")
    assert isinstance(exc_info.value, ImportError)
    assert "json" in str(exc_info.value)
