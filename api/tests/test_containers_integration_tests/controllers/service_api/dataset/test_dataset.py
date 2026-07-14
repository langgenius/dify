"""Container integration coverage for Service API dataset controllers."""

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from models.enums import TagType
from models.model import Tag
from tests.test_containers_integration_tests.controllers.console.helpers import create_console_account_and_tenant


@pytest.fixture
def app(flask_app_with_containers: Flask) -> Flask:
    return flask_app_with_containers


class TestDatasetTagsApiGet:
    """Exercise the unmocked tag query against the container database."""

    def test_list_tags_from_db(
        self,
        app: Flask,
        db_session_with_containers: Session,
        monkeypatch: pytest.MonkeyPatch,
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

        from controllers.service_api.dataset import dataset as dataset_module
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        monkeypatch.setattr(dataset_module, "current_user", account)

        with app.test_request_context("/datasets/tags", method="GET"):
            response, status = DatasetTagsApi().get(_=None)

        assert status == 200
        assert any(item["name"] == "Integration Tag" for item in response)
        assert all(set(item) == {"id", "name", "type", "binding_count"} for item in response)
        assert all(isinstance(item["binding_count"], str) for item in response)
