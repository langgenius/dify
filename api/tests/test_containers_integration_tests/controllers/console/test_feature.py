"""Integration tests for console feature endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from services.feature_service import FeatureModel, FeatureService, LimitationModel
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def test_feature_list_returns_current_tenant_configuration_without_vector_space(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    """Exercise auth, tenant injection, and the feature response shaping contract."""
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = tenant.id
    headers = authenticate_console_client(test_client_with_containers, account)
    feature_model = FeatureModel(
        members=LimitationModel(size=1, limit=2),
        apps=LimitationModel(size=3, limit=4),
        vector_space=LimitationModel(size=5, limit=6),
    )

    with patch.object(FeatureService, "get_features", return_value=feature_model) as get_features:
        response = test_client_with_containers.get(
            "/console/api/features",
            headers=headers,
        )

    assert response.status_code == 200
    assert response.json is not None
    assert response.json["members"] == {"size": 1, "limit": 2}
    assert response.json["apps"] == {"size": 3, "limit": 4}
    assert "vector_space" not in response.json
    get_features.assert_called_once_with(tenant_id, exclude_vector_space=True)


def test_feature_vector_space_returns_current_tenant_usage(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    """Exercise tenant injection and vector-space response serialization through the registered route."""
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = tenant.id
    headers = authenticate_console_client(test_client_with_containers, account)

    vector_space = SimpleNamespace(model_dump=lambda: {"size": 0, "limit": 100})

    with patch.object(FeatureService, "get_vector_space", return_value=vector_space) as get_vector_space:
        response = test_client_with_containers.get(
            "/console/api/features/vector-space",
            headers=headers,
        )

    assert response.status_code == 200
    assert response.json == {"size": 0, "limit": 100}
    get_vector_space.assert_called_once_with(tenant_id)
