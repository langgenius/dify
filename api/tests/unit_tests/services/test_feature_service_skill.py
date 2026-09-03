from collections.abc import Callable
from unittest.mock import MagicMock

import pytest

from enums import DeploymentEdition
from services import feature_service as feature_service_module
from services.entities.feature_entities import FeatureModel
from services.feature_service import FeatureService


def test_skill_feature_is_disabled_by_default() -> None:
    assert FeatureModel().enable_skill is True


def test_skill_feature_follows_env_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ENABLE_SKILL=True)

    features = FeatureService.get_features("")

    assert features.enable_skill is True


def test_empty_tenant_id_keeps_legacy_defaults_without_profile_query(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    resolve = MagicMock()
    monkeypatch.setattr(feature_service_module.ModelBillingProfileService, "resolve", resolve)

    features = FeatureService.get_features("")

    assert features.model_billing_source == "legacy_message_credits"
    assert features.tokener_bootstrap_status is None
    resolve.assert_not_called()
