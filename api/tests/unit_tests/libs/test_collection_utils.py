"""Unit tests for ``libs.collection_utils.convert_to_lower_and_upper_set``.

The helper builds case-insensitive lookup sets and has a few non-obvious
behaviours worth pinning: empty collections short-circuit, empty strings are
skipped by the ``if s`` guard, and results are deduplicated.
"""

from collections import deque
from collections.abc import Collection

import pytest

from libs.collection_utils import convert_to_lower_and_upper_set


def test_empty_list_returns_empty_set() -> None:
    assert convert_to_lower_and_upper_set([]) == set()


@pytest.mark.parametrize("empty", [(), set(), frozenset(), "", deque()])
def test_other_empty_collections_return_empty_set(empty: Collection[str]) -> None:
    # all of these are falsy Collections, so the guard returns early
    assert convert_to_lower_and_upper_set(empty) == set()


def test_single_string_yields_both_cases() -> None:
    assert convert_to_lower_and_upper_set(["Hello"]) == {"hello", "HELLO"}


def test_multiple_strings_yield_all_variants() -> None:
    result = convert_to_lower_and_upper_set(["AbC", "xYz"])
    assert result == {"abc", "ABC", "xyz", "XYZ"}


def test_case_variants_are_deduplicated() -> None:
    result = convert_to_lower_and_upper_set(["a", "A", "a"])
    assert result == {"a", "A"}


def test_mixed_case_input_is_normalized() -> None:
    result = convert_to_lower_and_upper_set(["MiXeD"])
    assert "mixed" in result
    assert "MIXED" in result


def test_empty_strings_are_skipped() -> None:
    result = convert_to_lower_and_upper_set(["abc", "", "XYZ"])
    assert result == {"abc", "ABC", "xyz", "XYZ"}


def test_only_empty_strings_yields_empty_set() -> None:
    assert convert_to_lower_and_upper_set(["", ""]) == set()


def test_result_is_a_set() -> None:
    assert isinstance(convert_to_lower_and_upper_set(["a"]), set)


def test_input_collection_is_not_mutated() -> None:
    original = ["AbC", "xYz"]
    convert_to_lower_and_upper_set(original)
    assert original == ["AbC", "xYz"]


@pytest.mark.parametrize("inputs", [("AbC",), frozenset({"AbC"}), deque(["AbC"])])
def test_accepts_any_collection(inputs: Collection[str]) -> None:
    assert convert_to_lower_and_upper_set(inputs) == {"abc", "ABC"}


def test_unicode_upper_expansion() -> None:
    result = convert_to_lower_and_upper_set(["Straße"])
    assert "straße" in result
    assert "STRASSE" in result


def test_numeric_strings_are_unchanged_by_case() -> None:
    result = convert_to_lower_and_upper_set(["123"])
    assert result == {"123"}


def test_punctuation_and_whitespace_preserved() -> None:
    result = convert_to_lower_and_upper_set([" A-b! "])
    assert result == {" a-b! ", " A-B! "}


def test_every_input_has_both_case_variants() -> None:
    inputs = ["Alpha", "BETA", "gamma"]
    result = convert_to_lower_and_upper_set(inputs)
    for value in inputs:
        assert value.lower() in result
        assert value.upper() in result
