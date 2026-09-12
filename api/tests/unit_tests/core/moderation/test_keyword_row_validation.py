from core.moderation.keywords.keywords import KeywordsModeration


def test_validate_config_ignores_trailing_blank_keyword_row() -> None:
    config = {
        "inputs_config": {"enabled": True, "preset_response": "Blocked"},
        "outputs_config": {"enabled": False},
        "keywords": "\n".join(f"word{i}" for i in range(100)) + "\n",
    }

    KeywordsModeration.validate_config("tenant", config)
