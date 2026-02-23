from datetime import UTC, datetime
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest

from controllers.service_api.end_user.end_user import EndUserApi
from controllers.service_api.end_user.error import EndUserNotFoundError
from models.model import App, EndUser


class TestEndUserApi:
    @pytest.fixture
    def resource(self) -> EndUserApi:
        return EndUserApi()

    @pytest.fixture
    def app_model(self) -> App:
        app = Mock(spec=App)
        app.id = str(uuid4())
        app.tenant_id = str(uuid4())
        return app

    def test_get_end_user_returns_all_attributes(self, mocker, resource: EndUserApi, app_model: App) -> None:
        end_user = Mock(spec=EndUser)
        end_user.id = str(uuid4())
        end_user.tenant_id = app_model.tenant_id
        end_user.app_id = app_model.id
        end_user.type = "service_api"
        end_user.external_user_id = "external-123"
        end_user.name = "Alice"
        end_user._is_anonymous = True
        end_user.session_id = "session-xyz"
        end_user.created_at = datetime(2024, 1, 1, tzinfo=UTC)
        end_user.updated_at = datetime(2024, 1, 2, tzinfo=UTC)

        get_end_user_by_id = mocker.patch(
            "controllers.service_api.end_user.end_user.EndUserService.get_end_user_by_id", return_value=end_user
        )

        result = EndUserApi.get.__wrapped__(resource, app_model=app_model, end_user_id=UUID(end_user.id))

        get_end_user_by_id.assert_called_once_with(
            tenant_id=app_model.tenant_id, app_id=app_model.id, end_user_id=end_user.id
        )
        assert result["id"] == end_user.id
        assert result["tenant_id"] == end_user.tenant_id
        assert result["app_id"] == end_user.app_id
        assert result["type"] == end_user.type
        assert result["external_user_id"] == end_user.external_user_id
        assert result["name"] == end_user.name
        assert result["is_anonymous"] is True
        assert result["session_id"] == end_user.session_id
        assert result["created_at"].startswith("2024-01-01T00:00:00")
        assert result["updated_at"].startswith("2024-01-02T00:00:00")

    def test_get_end_user_not_found(self, mocker, resource: EndUserApi, app_model: App) -> None:
        mocker.patch("controllers.service_api.end_user.end_user.EndUserService.get_end_user_by_id", return_value=None)

        with pytest.raises(EndUserNotFoundError):
            EndUserApi.get.__wrapped__(resource, app_model=app_model, end_user_id=uuid4())
