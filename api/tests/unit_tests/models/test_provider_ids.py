import pytest

from models.provider_ids import GenericProviderID, ModelProviderID, ToolProviderID


def test_parses_full_provider_id() -> None:
    provider = GenericProviderID("org/plugin/provider")

    assert provider.organization == "org"
    assert provider.plugin_name == "plugin"
    assert provider.provider_name == "provider"
    assert str(provider) == "org/plugin/provider"


def test_expands_short_provider_name() -> None:
    provider = GenericProviderID("openai")

    assert str(provider) == "langgenius/openai/openai"


@pytest.mark.parametrize(
    "value",
    ["org/plugin/provider\n", "openai\n", "org/plugin/provider\n\n"],
)
def test_rejects_provider_id_with_trailing_newline(value: str) -> None:
    with pytest.raises(ValueError, match="Invalid plugin id"):
        GenericProviderID(value)


def test_typed_ids_reject_trailing_newline() -> None:
    with pytest.raises(ValueError, match="Invalid plugin id"):
        ModelProviderID("google\n")
    with pytest.raises(ValueError, match="Invalid plugin id"):
        ToolProviderID("jina\n")
