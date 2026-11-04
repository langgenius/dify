"""
Unit tests for the external dataset controller payload schemas.

These tests focus on Pydantic validation rules so we can catch regressions
in request constraints (e.g. max length changes) without exercising the
full Flask/RESTX request stack.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalDatasetCreatePayload
from tests.unit_tests.controllers.conftest import app_query_services as app_query_services  # noqa: PLC0414
from tests.unit_tests.controllers.conftest import (
    datasource_application_dependencies as datasource_application_dependencies,  # noqa: PLC0414
)
from tests.unit_tests.controllers.conftest import error_response_contract as error_response_contract  # noqa: PLC0414
from tests.unit_tests.controllers.conftest import pipeline_application as pipeline_application  # noqa: PLC0414


def test_external_dataset_create_payload_allows_name_length_100() -> None:
    """Ensure the `name` field accepts up to 100 characters (inclusive)."""

    # Build a request payload with a boundary-length name value.
    name_100: str = "a" * 100
    payload = {
        "external_knowledge_api_id": "ek-api-1",
        "external_knowledge_id": "ek-1",
        "name": name_100,
    }

    model = ExternalDatasetCreatePayload.model_validate(payload)
    assert model.name == name_100


def test_external_dataset_create_payload_rejects_name_length_101() -> None:
    """Ensure the `name` field rejects values longer than 100 characters."""

    # Build a request payload that exceeds the max length by 1.
    name_101: str = "a" * 101
    payload: dict[str, object] = {
        "external_knowledge_api_id": "ek-api-1",
        "external_knowledge_id": "ek-1",
        "name": name_101,
    }

    with pytest.raises(ValidationError) as exc_info:
        ExternalDatasetCreatePayload.model_validate(payload)

    errors = exc_info.value.errors()
    assert errors[0]["loc"] == ("name",)
    assert errors[0]["type"] == "string_too_long"
    assert errors[0]["ctx"]["max_length"] == 100
