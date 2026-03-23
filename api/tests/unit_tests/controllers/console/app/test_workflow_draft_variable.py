from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request
from werkzeug.local import LocalProxy

from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.app.workflow_draft_variable import (
    ConversationVariableCollectionApi,
    EnvironmentVariableCollectionApi,
    NodeVariableCollectionApi,
    SystemVariableCollectionApi,
    VariableApi,
    VariableResetApi,
    WorkflowVariableCollectionApi,
)
from controllers.web.error import InvalidArgumentError, NotFoundError
from models import App, AppMode
from models.enums import DraftVariableType


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    flask_app.config["RESTX_MASK_HEADER"] = "X-Fields"
    return flask_app


@pytest.fixture
def mock_account():
    from models.account import Account, AccountStatus

    account = MagicMock(spec=Account)
    account.id = "user_123"
    account.timezone = "UTC"
    account.status = AccountStatus.ACTIVE
    account.is_admin_or_owner = True
    account.current_tenant.current_role = "owner"
    account.has_edit_permission = True
    return account


@pytest.fixture
def mock_app_model():
    app_model = MagicMock(spec=App)
    app_model.id = "app_123"
    app_model.mode = AppMode.WORKFLOW
    app_model.tenant_id = "tenant_123"
    return app_model


@pytest.fixture(autouse=True)
def mock_csrf():
    with patch("libs.login.check_csrf_token") as mock:
        yield mock


def setup_test_context(test_app, endpoint_class, route_path, method, mock_account, mock_app_model, payload=None):
    with (
        patch("controllers.console.app.wraps.db") as mock_db_wraps,
        patch("controllers.console.wraps.db", mock_db_wraps),
        patch("controllers.console.app.workflow_draft_variable.db"),
        patch("controllers.console.app.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
        patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
    ):
        mock_query = MagicMock()
        mock_query.filter.return_value.first.return_value = mock_app_model
        mock_query.filter.return_value.filter.return_value.first.return_value = mock_app_model
        mock_query.where.return_value.first.return_value = mock_app_model
        mock_query.where.return_value.where.return_value.first.return_value = mock_app_model
        mock_db_wraps.session.query.return_value = mock_query

        proxy_mock = LocalProxy(lambda: mock_account)

        with patch("libs.login.current_user", proxy_mock), patch("flask_login.current_user", proxy_mock):
            with test_app.test_request_context(route_path, method=method, json=payload):
                request.view_args = {"app_id": "app_123"}
                # extract node_id or variable_id from path manually since view_args overrides
                if "nodes/" in route_path:
                    request.view_args["node_id"] = route_path.split("nodes/")[1].split("/")[0]
                if "variables/" in route_path:
                    # simplistic extraction
                    parts = route_path.split("variables/")
                    if len(parts) > 1 and parts[1] and parts[1] != "reset":
                        request.view_args["variable_id"] = parts[1].split("/")[0]

                api_instance = endpoint_class()
                # we just call dispatch_request to avoid manual argument passing
                if hasattr(api_instance, method.lower()):
                    func = getattr(api_instance, method.lower())
                    return func(**request.view_args)


class TestWorkflowDraftVariableEndpoints:
    @staticmethod
    def _mock_workflow_variable(variable_type: DraftVariableType = DraftVariableType.NODE) -> MagicMock:
        class DummyValueType:
            def exposed_type(self):
                return DraftVariableType.NODE

        mock_var = MagicMock()
        mock_var.app_id = "app_123"
        mock_var.id = "var_123"
        mock_var.name = "test_var"
        mock_var.description = ""
        mock_var.get_variable_type.return_value = variable_type
        mock_var.get_selector.return_value = []
        mock_var.value_type = DummyValueType()
        mock_var.edited = False
        mock_var.visible = True
        mock_var.file_id = None
        mock_var.variable_file = None
        mock_var.is_truncated.return_value = False
        mock_var.get_value.return_value.model_copy.return_value.value = "test_value"
        return mock_var

    @patch("controllers.console.app.workflow_draft_variable.WorkflowService")
    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_workflow_variable_collection_get_success(
        self, mock_draft_srv, mock_wf_srv, app, mock_account, mock_app_model
    ):
        mock_wf_srv.return_value.is_workflow_exist.return_value = True
        from services.workflow_draft_variable_service import WorkflowDraftVariableList

        mock_draft_srv.return_value.list_variables_without_values.return_value = WorkflowDraftVariableList(
            variables=[], total=0
        )

        resp = setup_test_context(
            app,
            WorkflowVariableCollectionApi,
            "/apps/app_123/workflows/draft/variables?page=1&limit=20",
            "GET",
            mock_account,
            mock_app_model,
        )
        assert resp == {"items": [], "total": 0}

    @patch("controllers.console.app.workflow_draft_variable.WorkflowService")
    def test_workflow_variable_collection_get_not_exist(self, mock_wf_srv, app, mock_account, mock_app_model):
        mock_wf_srv.return_value.is_workflow_exist.return_value = False

        with pytest.raises(DraftWorkflowNotExist):
            setup_test_context(
                app,
                WorkflowVariableCollectionApi,
                "/apps/app_123/workflows/draft/variables",
                "GET",
                mock_account,
                mock_app_model,
            )

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_workflow_variable_collection_delete(self, mock_draft_srv, app, mock_account, mock_app_model):
        resp = setup_test_context(
            app,
            WorkflowVariableCollectionApi,
            "/apps/app_123/workflows/draft/variables",
            "DELETE",
            mock_account,
            mock_app_model,
        )
        assert resp.status_code == 204

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_node_variable_collection_get_success(self, mock_draft_srv, app, mock_account, mock_app_model):
        from services.workflow_draft_variable_service import WorkflowDraftVariableList

        mock_draft_srv.return_value.list_node_variables.return_value = WorkflowDraftVariableList(variables=[])
        resp = setup_test_context(
            app,
            NodeVariableCollectionApi,
            "/apps/app_123/workflows/draft/nodes/node_123/variables",
            "GET",
            mock_account,
            mock_app_model,
        )
        assert resp == {"items": []}

    def test_node_variable_collection_get_invalid_node_id(self, app, mock_account, mock_app_model):
        with pytest.raises(InvalidArgumentError):
            setup_test_context(
                app,
                NodeVariableCollectionApi,
                "/apps/app_123/workflows/draft/nodes/sys/variables",
                "GET",
                mock_account,
                mock_app_model,
            )

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_node_variable_collection_delete(self, mock_draft_srv, app, mock_account, mock_app_model):
        resp = setup_test_context(
            app,
            NodeVariableCollectionApi,
            "/apps/app_123/workflows/draft/nodes/node_123/variables",
            "DELETE",
            mock_account,
            mock_app_model,
        )
        assert resp.status_code == 204

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_variable_api_get_success(self, mock_draft_srv, app, mock_account, mock_app_model):
        mock_draft_srv.return_value.get_variable.return_value = self._mock_workflow_variable()

        resp = setup_test_context(
            app, VariableApi, "/apps/app_123/workflows/draft/variables/var_123", "GET", mock_account, mock_app_model
        )
        assert resp["id"] == "var_123"

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_variable_api_get_not_found(self, mock_draft_srv, app, mock_account, mock_app_model):
        mock_draft_srv.return_value.get_variable.return_value = None

        with pytest.raises(NotFoundError):
            setup_test_context(
                app, VariableApi, "/apps/app_123/workflows/draft/variables/var_123", "GET", mock_account, mock_app_model
            )

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_variable_api_patch_success(self, mock_draft_srv, app, mock_account, mock_app_model):
        mock_draft_srv.return_value.get_variable.return_value = self._mock_workflow_variable()

        resp = setup_test_context(
            app,
            VariableApi,
            "/apps/app_123/workflows/draft/variables/var_123",
            "PATCH",
            mock_account,
            mock_app_model,
            payload={"name": "new_name"},
        )
        assert resp["id"] == "var_123"
        mock_draft_srv.return_value.update_variable.assert_called_once()

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_variable_api_delete_success(self, mock_draft_srv, app, mock_account, mock_app_model):
        mock_draft_srv.return_value.get_variable.return_value = self._mock_workflow_variable()

        resp = setup_test_context(
            app, VariableApi, "/apps/app_123/workflows/draft/variables/var_123", "DELETE", mock_account, mock_app_model
        )
        assert resp.status_code == 204
        mock_draft_srv.return_value.delete_variable.assert_called_once()

    @patch("controllers.console.app.workflow_draft_variable.WorkflowService")
    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_variable_reset_api_put_success(self, mock_draft_srv, mock_wf_srv, app, mock_account, mock_app_model):
        mock_wf_srv.return_value.get_draft_workflow.return_value = MagicMock()
        mock_draft_srv.return_value.get_variable.return_value = self._mock_workflow_variable()
        mock_draft_srv.return_value.reset_variable.return_value = None  # means no content

        resp = setup_test_context(
            app,
            VariableResetApi,
            "/apps/app_123/workflows/draft/variables/var_123/reset",
            "PUT",
            mock_account,
            mock_app_model,
        )
        assert resp.status_code == 204

    @patch("controllers.console.app.workflow_draft_variable.WorkflowService")
    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_conversation_variable_collection_get(self, mock_draft_srv, mock_wf_srv, app, mock_account, mock_app_model):
        mock_wf_srv.return_value.get_draft_workflow.return_value = MagicMock()
        from services.workflow_draft_variable_service import WorkflowDraftVariableList

        mock_draft_srv.return_value.list_conversation_variables.return_value = WorkflowDraftVariableList(variables=[])

        resp = setup_test_context(
            app,
            ConversationVariableCollectionApi,
            "/apps/app_123/workflows/draft/conversation-variables",
            "GET",
            mock_account,
            mock_app_model,
        )
        assert resp == {"items": []}

    @patch("controllers.console.app.workflow_draft_variable.WorkflowDraftVariableService")
    def test_system_variable_collection_get(self, mock_draft_srv, app, mock_account, mock_app_model):
        from services.workflow_draft_variable_service import WorkflowDraftVariableList

        mock_draft_srv.return_value.list_system_variables.return_value = WorkflowDraftVariableList(variables=[])

        resp = setup_test_context(
            app,
            SystemVariableCollectionApi,
            "/apps/app_123/workflows/draft/system-variables",
            "GET",
            mock_account,
            mock_app_model,
        )
        assert resp == {"items": []}

    @patch("controllers.console.app.workflow_draft_variable.WorkflowService")
    def test_environment_variable_collection_get(self, mock_wf_srv, app, mock_account, mock_app_model):
        mock_wf = MagicMock()
        mock_wf.environment_variables = []
        mock_wf_srv.return_value.get_draft_workflow.return_value = mock_wf

        resp = setup_test_context(
            app,
            EnvironmentVariableCollectionApi,
            "/apps/app_123/workflows/draft/environment-variables",
            "GET",
            mock_account,
            mock_app_model,
        )
        assert resp == {"items": []}
