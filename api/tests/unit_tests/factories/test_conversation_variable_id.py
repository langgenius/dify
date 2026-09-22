from factories import variable_factory


def test_factory_keeps_a_hand_written_conversation_variable_id() -> None:
    """Draft and API reads keep the author id. The UUID column is coerced later, on insert."""
    result = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": "opt-comp-prompt-var",
            "name": "optimization_comparison_prompt",
            "value_type": "string",
            "value": "-",
        }
    )
    assert result.id == "opt-comp-prompt-var"
    assert result.name == "optimization_comparison_prompt"
    assert result.value == "-"
