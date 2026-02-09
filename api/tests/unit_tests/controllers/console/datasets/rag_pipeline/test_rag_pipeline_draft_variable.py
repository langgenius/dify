from unittest.mock import MagicMock, patch

import pytest
from flask import Response

from controllers.console import console_ns
from controllers.console.app.error import DraftWorkflowNotExist
from controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable import (
    RagPipelineEnvironmentVariableCollectionApi,
    RagPipelineNodeVariableCollectionApi,
    RagPipelineSystemVariableCollectionApi,
    RagPipelineVariableApi,
    RagPipelineVariableCollectionApi,
    RagPipelineVariableResetApi,
)
from controllers.web.error import InvalidArgumentError, NotFoundError
from core.variables.types import SegmentType
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from models.account import Account


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def fake_db():
    db = MagicMock()
    db.engine = MagicMock()
    db.session.return_value = MagicMock()
    return db


@pytest.fixture
def editor_user():
    user = MagicMock(spec=Account)
    user.has_edit_permission = True
    return user


@pytest.fixture
def restx_config(app):
    return patch.dict(app.config, {"RESTX_MASK_HEADER": "X-Fields"})


class TestRagPipelineVariableCollectionApi:
    def test_get_variables_success(self, app, fake_db, editor_user, restx_config):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock(id="p1")

        rag_srv = MagicMock()
        rag_srv.is_workflow_exist.return_value = True

        # IMPORTANT: RESTX expects .variables
        var_list = MagicMock()
        var_list.variables = []

        draft_srv = MagicMock()
        draft_srv.list_variables_without_values.return_value = var_list

        with (
            app.test_request_context("/?page=1&limit=10"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=draft_srv,
            ),
        ):
            result = method(api, pipeline)

        assert result["items"] == []

    def test_get_variables_workflow_not_exist(self, app, fake_db, editor_user):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock()

        rag_srv = MagicMock()
        rag_srv.is_workflow_exist.return_value = False

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
        ):
            with pytest.raises(DraftWorkflowNotExist):
                method(api, pipeline)

    def test_delete_variables_success(self, app, fake_db, editor_user):
        api = RagPipelineVariableCollectionApi()
        method = unwrap(api.delete)

        pipeline = MagicMock(id="p1")

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService"),
        ):
            result = method(api, pipeline)

        assert isinstance(result, Response)
        assert result.status_code == 204


class TestRagPipelineNodeVariableCollectionApi:
    def test_get_node_variables_success(self, app, fake_db, editor_user, restx_config):
        api = RagPipelineNodeVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock(id="p1")

        var_list = MagicMock()
        var_list.variables = []

        srv = MagicMock()
        srv.list_node_variables.return_value = var_list

        with (
            app.test_request_context("/"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, pipeline, "node1")

        assert result["items"] == []

    def test_get_node_variables_invalid_node(self, app, editor_user):
        api = RagPipelineNodeVariableCollectionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
        ):
            with pytest.raises(InvalidArgumentError):
                method(api, MagicMock(), SYSTEM_VARIABLE_NODE_ID)


class TestRagPipelineVariableApi:
    def test_get_variable_not_found(self, app, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.get)

        srv = MagicMock()
        srv.get_variable.return_value = None

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            with pytest.raises(NotFoundError):
                method(api, MagicMock(), "v1")

    def test_patch_variable_invalid_file_payload(self, app, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.patch)

        pipeline = MagicMock(id="p1", tenant_id="t1")
        variable = MagicMock(app_id="p1", value_type=SegmentType.FILE)

        srv = MagicMock()
        srv.get_variable.return_value = variable

        payload = {"value": "invalid"}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            with pytest.raises(InvalidArgumentError):
                method(api, pipeline, "v1")

    def test_delete_variable_success(self, app, fake_db, editor_user):
        api = RagPipelineVariableApi()
        method = unwrap(api.delete)

        pipeline = MagicMock(id="p1")
        variable = MagicMock(app_id="p1")

        srv = MagicMock()
        srv.get_variable.return_value = variable

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, pipeline, "v1")

        assert result.status_code == 204


class TestRagPipelineVariableResetApi:
    def test_reset_variable_success(self, app, fake_db, editor_user):
        api = RagPipelineVariableResetApi()
        method = unwrap(api.put)

        pipeline = MagicMock(id="p1")
        workflow = MagicMock()
        variable = MagicMock(app_id="p1")

        srv = MagicMock()
        srv.get_variable.return_value = variable
        srv.reset_variable.return_value = variable

        rag_srv = MagicMock()
        rag_srv.get_draft_workflow.return_value = workflow

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.marshal",
                return_value={"id": "v1"},
            ),
        ):
            result = method(api, pipeline, "v1")

        assert result == {"id": "v1"}


class TestSystemAndEnvironmentVariablesApi:
    def test_system_variables_success(self, app, fake_db, editor_user, restx_config):
        api = RagPipelineSystemVariableCollectionApi()
        method = unwrap(api.get)

        pipeline = MagicMock(id="p1")

        var_list = MagicMock()
        var_list.variables = []

        srv = MagicMock()
        srv.list_system_variables.return_value = var_list

        with (
            app.test_request_context("/"),
            restx_config,
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.db", fake_db),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.WorkflowDraftVariableService",
                return_value=srv,
            ),
        ):
            result = method(api, pipeline)

        assert result["items"] == []

    def test_environment_variables_success(self, app, editor_user):
        api = RagPipelineEnvironmentVariableCollectionApi()
        method = unwrap(api.get)

        env_var = MagicMock(
            id="e1",
            name="ENV",
            description="d",
            selector="s",
            value_type=MagicMock(value="string"),
            value="x",
        )

        workflow = MagicMock(environment_variables=[env_var])
        pipeline = MagicMock(id="p1")

        rag_srv = MagicMock()
        rag_srv.get_draft_workflow.return_value = workflow

        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.current_user", editor_user),
            patch(
                "controllers.console.datasets.rag_pipeline.rag_pipeline_draft_variable.RagPipelineService",
                return_value=rag_srv,
            ),
        ):
            result = method(api, pipeline)

        assert len(result["items"]) == 1
