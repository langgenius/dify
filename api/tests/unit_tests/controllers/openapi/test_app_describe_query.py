"""Unit tests for AppDescribeQuery (`?fields=` allow-list)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.openapi.apps import AppDescribeQuery


def test_no_fields_returns_none() -> None:
    q = AppDescribeQuery.model_validate({})
    assert q.fields is None


def test_empty_string_returns_none() -> None:
    q = AppDescribeQuery.model_validate({"fields": ""})
    assert q.fields is None


def test_single_field() -> None:
    q = AppDescribeQuery.model_validate({"fields": "info"})
    assert q.fields == {"info"}


def test_comma_list() -> None:
    q = AppDescribeQuery.model_validate({"fields": "info,parameters"})
    assert q.fields == {"info", "parameters"}


def test_whitespace_tolerant() -> None:
    q = AppDescribeQuery.model_validate({"fields": " info , input_schema "})
    assert q.fields == {"info", "input_schema"}


def test_unknown_member_rejected() -> None:
    with pytest.raises(ValidationError):
        AppDescribeQuery.model_validate({"fields": "garbage"})


def test_unknown_among_known_rejected() -> None:
    with pytest.raises(ValidationError):
        AppDescribeQuery.model_validate({"fields": "info,garbage"})


def test_extra_param_forbidden() -> None:
    with pytest.raises(ValidationError):
        AppDescribeQuery.model_validate({"fields": "info", "page": "1"})
