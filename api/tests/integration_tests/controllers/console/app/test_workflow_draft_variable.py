import uuid
from unittest import mock

import pytest
from flask import FlaskClient

from controllers.console.app import workflow_draft_variable as draft_variable_api
from controllers.console.app import wraps
from factories.variable_factory import build_segment
from models import App, AppMode
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import WorkflowDraftVariableList, WorkflowDraftVariableService


def _get_mock_srv_class() -> type[WorkflowDraftVariableService]:
    return mock.create_autospec(WorkflowDraftVariableService)


class TestWorkflowDraftNodeVariableListApi:
    def test_get(self, test_client: FlaskClient, auth_header, monkeypatch: pytest.MonkeyPatch):
        srv_class = _get_mock_srv_class()
        mock_app_model = App(id=str(uuid.uuid4()), mode=AppMode.ADVANCED_CHAT)
        test_node_id = "test_node_id"
        mock_load_app_model = mock.Mock(return_value=mock_app_model)

        monkeypatch.setattr(draft_variable_api, "WorkflowDraftVariableService", srv_class)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        var1 = WorkflowDraftVariable.new_node_variable(
            app_id="test_app_1",
            node_id="test_node_1",
            name="str_var",
            value=build_segment("str_value"),
            node_execution_id=str(uuid.uuid4()),
        )
        srv_instance = mock.create_autospec(WorkflowDraftVariableService, instance=True)
        srv_class.return_value = srv_instance
        srv_instance.list_node_variables.return_value = WorkflowDraftVariableList(variables=[var1])

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/workflows/draft/nodes/{test_node_id}/variables",
            headers=auth_header,
        )
        assert response.status_code == 200
        response_dict = response.json
        assert isinstance(response_dict, dict)
        assert "items" in response_dict
        assert len(response_dict["items"]) == 1
