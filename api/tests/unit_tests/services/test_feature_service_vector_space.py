from typing import cast
from unittest.mock import patch

from enums import CloudPlan, DeploymentEdition
from services.billing_service import BillingInfo
from services.entities.feature_entities import LimitationModel
from services.feature_service import FeatureService


def test_get_features_exclude_vector_space_sets_vector_space_to_none(config_overrides):
    tenant_id = "tenant-id"
    billing_info = {
        "enabled": True,
        "subscription": {"plan": CloudPlan.PROFESSIONAL, "interval": "monthly", "education": False},
        "members": {"size": 1, "limit": 10},
        "apps": {"size": 2, "limit": 20},
        "documents_upload_quota": {"size": 3, "limit": 100},
        "annotation_quota_limit": {"size": 4, "limit": 50},
        "docs_processing": "standard",
        "can_replace_logo": True,
        "model_load_balancing_enabled": True,
        "knowledge_rate_limit": {"limit": 100},
        "knowledge_pipeline_publish_enabled": True,
    }

    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        CAN_REPLACE_LOGO=False,
        MODEL_LB_ENABLED=False,
        DATASET_OPERATOR_ENABLED=False,
        EDUCATION_ENABLED=False,
    )
    with (
        patch("services.feature_service.BillingService.get_info", return_value=billing_info) as get_info,
        patch("services.feature_service.BillingService.get_quota_info", return_value={}),
    ):
        features = FeatureService.get_features(tenant_id, exclude_vector_space=True)

    assert features.vector_space is None
    get_info.assert_called_once_with(tenant_id, exclude_vector_space=True)


def test_full_features_keep_treating_unknown_vector_usage_as_zero():
    vector_space = LimitationModel()

    FeatureService._fulfill_vector_space_from_billing_info(
        vector_space,
        cast(BillingInfo, {"vector_space": {"size": 0.0, "limit": 50, "usage_unknown": True}}),
    )

    assert vector_space.size == 0
    assert vector_space.limit == 50
