import pytest
from werkzeug.exceptions import NotFound

from models.provider_ids import (
    DatasourceProviderID,
    GenericProviderID,
    ModelProviderID,
    ToolProviderID,
    TriggerProviderID,
)


@pytest.mark.parametrize(
    "provider_type", [GenericProviderID, ModelProviderID, ToolProviderID, DatasourceProviderID, TriggerProviderID]
)
def test_legacy_provider_ids_preserve_missing_and_invalid_errors(provider_type: type[GenericProviderID]) -> None:
    with pytest.raises(NotFound, match="plugin not found, please add plugin"):
        provider_type("")
    with pytest.raises(ValueError, match="Invalid plugin id invalid/provider"):
        provider_type("invalid/provider")


@pytest.mark.parametrize("provider", ["jina", "siliconflow", "stepfun", "gitee_ai"])
def test_tool_identity_retains_aliases_and_hardcoded_flag(provider: str) -> None:
    identity = ToolProviderID(provider, is_hardcoded=True)
    assert str(identity) == f"langgenius/{provider}_tool/{provider}"
    assert identity.plugin_id == f"langgenius/{provider}_tool"
    assert identity.is_hardcoded
    assert identity.is_langgenius()
    assert str(ToolProviderID(f"vendor/{provider}/{provider}")) == f"vendor/{provider}/{provider}"


def test_model_alias_remains_distinct_from_tool_aliases() -> None:
    assert str(ModelProviderID("google")) == "langgenius/gemini/google"
    assert str(ToolProviderID("google")) == "langgenius/google/google"
