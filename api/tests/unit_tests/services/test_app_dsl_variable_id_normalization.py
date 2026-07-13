import uuid

from services.app_dsl_service import _normalize_variable_id_mappings


def _is_uuid(value: object) -> bool:
    try:
        uuid.UUID(str(value))
    except (ValueError, TypeError):
        return False
    return True


class TestNormalizeVariableIdMappings:
    def test_non_uuid_id_is_regenerated(self) -> None:
        result = _normalize_variable_id_mappings(
            [
                {
                    "id": "opt-comp-prompt-var",
                    "name": "optimization_comparison_prompt",
                    "value_type": "string",
                    "value": "-",
                }
            ]
        )
        assert _is_uuid(result[0]["id"])
        assert result[0]["name"] == "optimization_comparison_prompt"
        assert result[0]["value"] == "-"

    def test_valid_uuid_id_is_preserved(self) -> None:
        valid = str(uuid.uuid4())
        result = _normalize_variable_id_mappings([{"id": valid, "name": "x", "value_type": "string", "value": "-"}])
        assert result[0]["id"] == valid

    def test_missing_id_is_generated(self) -> None:
        result = _normalize_variable_id_mappings([{"name": "x", "value_type": "string", "value": "-"}])
        assert _is_uuid(result[0]["id"])

    def test_non_mapping_items_pass_through(self) -> None:
        result = _normalize_variable_id_mappings(["not-a-mapping", 123])
        assert result == ["not-a-mapping", 123]

    def test_empty_list(self) -> None:
        assert _normalize_variable_id_mappings([]) == []
