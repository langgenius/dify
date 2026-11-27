from collections.abc import Callable

import pytest

from domain.plugins.provider_id import normalize_provider_id, normalize_tool_provider_id


@pytest.mark.parametrize("provider", ["calendar", "jina", "siliconflow", "stepfun", "gitee_ai"])
def test_shorthand_and_canonical_provider_ids_share_one_identity(provider: str) -> None:
    canonical = f"langgenius/{provider}/{provider}"
    assert normalize_provider_id(provider) == canonical
    assert normalize_provider_id(canonical) == canonical
    assert normalize_tool_provider_id(provider) == normalize_tool_provider_id(canonical)


@pytest.mark.parametrize("provider", ["jina", "siliconflow", "stepfun", "gitee_ai"])
def test_tool_aliases_preserve_organization_and_provider_boundaries(provider: str) -> None:
    assert normalize_tool_provider_id(provider) == f"langgenius/{provider}_tool/{provider}"
    assert normalize_tool_provider_id(f"vendor/{provider}/{provider}") == f"vendor/{provider}/{provider}"
    assert normalize_tool_provider_id(f"langgenius/{provider}/other") == f"langgenius/{provider}/other"
    canonical = f"langgenius/{provider}_tool/{provider}"
    assert normalize_tool_provider_id(canonical) == canonical


@pytest.mark.parametrize("value", ["", "invalid/provider", "vendor/plugin/provider/extra", "INVALID", " "])
@pytest.mark.parametrize("normalize", [normalize_provider_id, normalize_tool_provider_id])
def test_invalid_provider_ids_raise_framework_neutral_errors(value: str, normalize: Callable[[str], str]) -> None:
    with pytest.raises(ValueError, match="Invalid plugin id"):
        normalize(value)
