from collections.abc import Callable

import pytest

from services.feature_service import FeatureService


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_enable_change_email(
    config_overrides: Callable[..., None],
    enabled: bool,
) -> None:
    config_overrides(ENABLE_CHANGE_EMAIL=enabled)

    result = FeatureService.get_system_features()

    assert result.enable_change_email is enabled
