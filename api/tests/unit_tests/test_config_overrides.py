"""Contract tests for the shared unit-test config override fixture."""

from collections.abc import Callable

import pytest

from configs import dify_config
from enums import DeploymentEdition


def test_config_overrides_updates_shared_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    assert dify_config.DEPLOYMENT_EDITION is DeploymentEdition.CLOUD


def test_config_overrides_rejects_unknown_fields(config_overrides: Callable[..., None]) -> None:
    with pytest.raises(ValueError, match=r"Unknown DifyConfig fields: \['NOT_A_CONFIG_FIELD'\]"):
        config_overrides(NOT_A_CONFIG_FIELD=True)
