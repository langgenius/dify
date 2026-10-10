"""Metadata contracts retain the domain's types and existing scalar values."""

import pytest

from fields.base import ResponseModel
from fields.dataset_fields import (
    DatasetMetadataBuiltInFieldResponse,
    DatasetMetadataListItemResponse,
    DatasetMetadataResponse,
)
from fields.document_fields import DocumentMetadataResponse
from models.enums import DatasetMetadataType


@pytest.mark.parametrize(
    "response_model",
    [
        DatasetMetadataResponse,
        DatasetMetadataListItemResponse,
        DatasetMetadataBuiltInFieldResponse,
        DocumentMetadataResponse,
    ],
)
@pytest.mark.parametrize("field_type", list(DatasetMetadataType))
def test_metadata_response_documents_and_serializes_domain_type(
    response_model: type[ResponseModel], field_type: DatasetMetadataType
) -> None:
    schema = response_model.model_json_schema(mode="serialization")
    assert schema["properties"]["type"]["$ref"] == "#/$defs/DatasetMetadataType"
    assert set(schema["$defs"]["DatasetMetadataType"]["enum"]) == {"string", "number", "time"}

    response = response_model.model_validate({"id": "field-1", "name": "field", "type": field_type})
    assert response.model_dump(mode="json")["type"] == field_type.value


@pytest.mark.parametrize("value", [0, "", None, False, True])
def test_document_metadata_preserves_empty_and_legacy_values(value: str | int | bool | None) -> None:
    response = DocumentMetadataResponse(id="field-1", name="field", type=DatasetMetadataType.NUMBER, value=value)
    serialized = response.model_dump(mode="json")["value"]
    assert serialized == value
    assert type(serialized) is type(value)
