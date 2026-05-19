from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayer


def test_prompt_layer_type_id_constant_matches_implementation_class() -> None:
    assert PLAIN_PROMPT_LAYER_TYPE_ID == "plain.prompt"
    assert PromptLayer.type_id == PLAIN_PROMPT_LAYER_TYPE_ID
