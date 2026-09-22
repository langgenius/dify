from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from factories import variable_factory


def _is_uuid(value: object) -> bool:
    try:
        UUID(str(value))
    except (ValueError, TypeError):
        return False
    return True


def test_non_uuid_conversation_variable_id_is_coerced() -> None:
    result = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": "opt-comp-prompt-var",
            "name": "optimization_comparison_prompt",
            "value_type": "string",
            "value": "-",
        }
    )
    assert _is_uuid(result.id)
    assert result.name == "optimization_comparison_prompt"
    assert result.value == "-"
    assert result.id == str(
        uuid5(NAMESPACE_URL, "dify:conversation-variable:optimization_comparison_prompt")
    )


def test_non_uuid_conversation_variable_id_is_stable_for_the_same_name() -> None:
    mapping = {
        "id": "opt-comp-prompt-var",
        "name": "optimization_comparison_prompt",
        "value_type": "string",
        "value": "-",
    }
    first = variable_factory.build_conversation_variable_from_mapping(mapping)
    second = variable_factory.build_conversation_variable_from_mapping(mapping)
    assert first.id == second.id


def test_valid_uuid_conversation_variable_id_is_preserved() -> None:
    original = str(uuid4())
    result = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": original,
            "name": "kept",
            "value_type": "string",
            "value": "ok",
        }
    )
    assert result.id == original
