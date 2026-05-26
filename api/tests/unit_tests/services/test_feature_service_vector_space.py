from unittest.mock import patch

from services.feature_service import FeatureService


def test_get_features_exclude_vector_space_sets_vector_space_to_none():
    tenant_id = "tenant-id"
    billing_info = {
        "enabled": True,
        "subscription": {"plan": "pro", "interval": "monthly", "education": False},
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

    with (
        patch("services.feature_service.dify_config") as mock_config,
        patch("services.feature_service.BillingService.get_info", return_value=billing_info) as get_info,
        patch("services.feature_service.BillingService.get_quota_info", return_value={}),
    ):
        mock_config.BILLING_ENABLED = True
        mock_config.ENTERPRISE_ENABLED = False
        mock_config.CAN_REPLACE_LOGO = False
        mock_config.MODEL_LB_ENABLED = False
        mock_config.DATASET_OPERATOR_ENABLED = False
        mock_config.EDUCATION_ENABLED = False

        features = FeatureService.get_features(tenant_id, exclude_vector_space=True)

    assert features.vector_space is None
    get_info.assert_called_once_with(tenant_id, exclude_vector_space=True)
