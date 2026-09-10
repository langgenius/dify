"""Container integration coverage for Service API dataset controllers."""

from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from models.account import Account
from models.enums import TagType
from models.model import Tag
from tests.test_containers_integration_tests.controllers.console.helpers import create_console_account_and_tenant


@pytest.fixture
def app(flask_app_with_containers: Flask) -> Flask:
    return flask_app_with_containers


class TestDatasetTagsApiGet:
    """Exercise the unmocked tag query against the container database."""

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_list_tags_from_db(
        self,
        mock_current_user,
        app: Flask,
        db_session_with_containers: Session,
    ) -> None:
        account, tenant = create_console_account_and_tenant(db_session_with_containers)
        tag = Tag(
            name="Integration Tag",
            type=TagType.KNOWLEDGE,
            created_by=account.id,
            tenant_id=tenant.id,
        )
        db_session_with_containers.add(tag)
        db_session_with_containers.commit()

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = tenant.id

        from controllers.service_api.dataset.dataset import DatasetTagsApi

        with app.test_request_context("/datasets/tags", method="GET"):
            response, status = DatasetTagsApi().get(_=None)

        assert status == 200
        assert any(item["name"] == "Integration Tag" for item in response)
        assert all(set(item) == {"id", "name", "type", "binding_count"} for item in response)
        assert all(isinstance(item["binding_count"], str) for item in response)
