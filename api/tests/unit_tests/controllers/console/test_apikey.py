from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.console.apikey import (
    BaseApiKeyListResource,
    BaseApiKeyResource,
    _get_resource,
)


@pytest.fixture
def tenant_context_admin():
    with patch("controllers.console.apikey.current_account_with_tenant") as mock:
        user = MagicMock()
        user.is_admin_or_owner = True
        mock.return_value = (user, "tenant-123")
        yield mock


@pytest.fixture
def tenant_context_non_admin():
    with patch("controllers.console.apikey.current_account_with_tenant") as mock:
        user = MagicMock()
        user.is_admin_or_owner = False
        mock.return_value = (user, "tenant-123")
        yield mock


@pytest.fixture
def db_mock():
    with patch("controllers.console.apikey.db") as mock_db:
        mock_db.session = MagicMock()
        yield mock_db


@pytest.fixture(autouse=True)
def bypass_permissions():
    with patch(
        "controllers.console.apikey.edit_permission_required",
        lambda f: f,
    ):
        yield


class DummyApiKeyListResource(BaseApiKeyListResource):
    resource_type = "app"
    resource_model = MagicMock()
    resource_id_field = "app_id"
    token_prefix = "app-"


class DummyApiKeyResource(BaseApiKeyResource):
    resource_type = "app"
    resource_model = MagicMock()
    resource_id_field = "app_id"


class TestGetResource:
    def test_get_resource_success(self):
        fake_resource = MagicMock()

        with (
            patch("controllers.console.apikey.select") as mock_select,
            patch("controllers.console.apikey.Session") as mock_session,
            patch("controllers.console.apikey.db") as mock_db,
        ):
            mock_db.engine = MagicMock()
            mock_select.return_value.filter_by.return_value = MagicMock()

            session = mock_session.return_value.__enter__.return_value
            session.execute.return_value.scalar_one_or_none.return_value = fake_resource

            result = _get_resource("rid", "tid", MagicMock)
            assert result == fake_resource

    def test_get_resource_not_found(self):
        with (
            patch("controllers.console.apikey.select") as mock_select,
            patch("controllers.console.apikey.Session") as mock_session,
            patch("controllers.console.apikey.db") as mock_db,
            patch("controllers.console.apikey.flask_restx.abort") as abort,
        ):
            mock_db.engine = MagicMock()
            mock_select.return_value.filter_by.return_value = MagicMock()

            session = mock_session.return_value.__enter__.return_value
            session.execute.return_value.scalar_one_or_none.return_value = None

            _get_resource("rid", "tid", MagicMock)

            abort.assert_called_once()


class TestBaseApiKeyListResource:
    def test_get_apikeys_success(self, tenant_context_admin, db_mock):
        resource = DummyApiKeyListResource()

        with patch("controllers.console.apikey._get_resource"):
            db_mock.session.scalars.return_value.all.return_value = [MagicMock(), MagicMock()]

            result = DummyApiKeyListResource.get.__wrapped__(resource, "resource-id")
            assert "items" in result


class TestBaseApiKeyResource:
    def test_delete_forbidden(self, tenant_context_non_admin, db_mock):
        resource = DummyApiKeyResource()

        with patch("controllers.console.apikey._get_resource"):
            with pytest.raises(Forbidden):
                DummyApiKeyResource.delete(resource, "rid", "kid")

    def test_delete_key_not_found(self, tenant_context_admin, db_mock):
        resource = DummyApiKeyResource()
        db_mock.session.query.return_value.where.return_value.first.return_value = None

        with patch("controllers.console.apikey._get_resource"):
            with pytest.raises(Exception) as exc_info:
                DummyApiKeyResource.delete(resource, "rid", "kid")

            # flask_restx.abort raises HTTPException with message in data attribute
            assert exc_info.value.data["message"] == "API key not found"

    def test_delete_success(self, tenant_context_admin, db_mock):
        resource = DummyApiKeyResource()
        db_mock.session.query.return_value.where.return_value.first.return_value = MagicMock()

        with (
            patch("controllers.console.apikey._get_resource"),
            patch("controllers.console.apikey.ApiTokenCache.delete"),
        ):
            result, status = DummyApiKeyResource.delete(resource, "rid", "kid")

            assert status == 204
            assert result == {"result": "success"}
            db_mock.session.commit.assert_called_once()
